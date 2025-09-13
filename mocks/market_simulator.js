// --- 0. GLOBAL STATE AND CONFIGURATION ---
let periodCounter = 0;
let pinnedDemandRequests = [];
let floatingDemandRequests = [];
let requestIdCounter = 0;

// The persistent state of the system
const CLUSTER_DATA = {
    "us-east-1": { total_capacity: 1024, guaranteed_sold: 300, base_guaranteed: 1.00, base_spot: 0.20, sensitivity_g: 2.0, sensitivity_s: 1.2 },
    "eu-west-2": { total_capacity: 512, guaranteed_sold: 400, base_guaranteed: 1.10, base_spot: 0.22, sensitivity_g: 2.2, sensitivity_s: 1.3 },
    "ap-northeast-1": { total_capacity: 2048, guaranteed_sold: 100, base_guaranteed: 0.90, base_spot: 0.18, sensitivity_g: 1.8, sensitivity_s: 1.1 }
};

// --- DOM ELEMENTS ---
const periodCounterEl = document.getElementById('period-counter');
const runAlgorithmBtn = document.getElementById('run-algorithm-btn');
const addPinnedBtn = document.getElementById('add-pinned-btn');
const addFloatingBtn = document.getElementById('add-floating-btn');
const demandQueueDisplay = document.getElementById('demand-queue-display');
const clusterStateDisplay = document.getElementById('cluster-state-display');
const priceListDisplay = document.getElementById('price-list-display');
const allocationPlanDisplay = document.getElementById('allocation-plan-display');

// --- 1. CORE ALGORITHM FUNCTIONS ---

function calculateGuaranteedPrice(clusterId, clusterData) {
    const cluster = clusterData[clusterId];
    if (!cluster) return 0;
    const utilization = cluster.guaranteed_sold / cluster.total_capacity;
    const adjustmentFactor = Math.pow(1 + utilization, cluster.sensitivity_g);
    return cluster.base_guaranteed * adjustmentFactor;
}

function calculateSpotPriceForDemand(clusterId, demand, clusterData) {
    const cluster = clusterData[clusterId];
    const availableSpotSupply = cluster.total_capacity - cluster.guaranteed_sold;
    
    if (availableSpotSupply <= 0) return Infinity; // No supply
    if (demand <= 0) demand = 0.1; // Prevent price from being zero
    if (demand > availableSpotSupply) return Infinity; // Demand exceeds supply

    const ratio = demand / availableSpotSupply;
    const adjustmentFactor = Math.pow(ratio, cluster.sensitivity_s);
    let finalPrice = cluster.base_spot * adjustmentFactor;
    
    // Apply a floor/ceiling
    const priceFloor = cluster.base_spot * 0.5;
    const priceCeiling = cluster.base_spot * 10.0;
    finalPrice = Math.max(priceFloor, Math.min(priceCeiling, finalPrice));

    return finalPrice;
}

function runMarketClearingPeriod() {
    periodCounter++;
    
    // --- OUTPUT OBJECTS ---
    const price_list = { guaranteed_prices: {}, spot_prices: {} };
    const allocation_plan = {
        satisfied_demand: { pinned: [], floating: [] },
        unsatisfied_demand: { pinned: [], floating: [] }
    };

    // --- STEP 1: Calculate Prices for NEW Guaranteed Sales ---
    for (const clusterId in CLUSTER_DATA) {
        price_list.guaranteed_prices[clusterId] = calculateGuaranteedPrice(clusterId, CLUSTER_DATA);
    }

    // --- STEP 2: Clear the Spot Market ---
    const spotMarketState = {};
    const pinnedDemandTotals = pinnedDemandRequests.reduce((acc, req) => {
        acc[req.cluster] = (acc[req.cluster] || 0) + req.quantity;
        return acc;
    }, {});

    // A. Handle Pinned Demand
    for (const clusterId in CLUSTER_DATA) {
        const availableSupply = CLUSTER_DATA[clusterId].total_capacity - CLUSTER_DATA[clusterId].guaranteed_sold;
        const demand = pinnedDemandTotals[clusterId] || 0;
        
        const satisfiedPinned = Math.min(availableSupply, demand);
        
        // Track satisfied pinned requests
        let satisfiedAmountTracker = satisfiedPinned;
        pinnedDemandRequests.filter(r => r.cluster === clusterId).forEach(req => {
            if (satisfiedAmountTracker > 0) {
                const amountToSatisfy = Math.min(req.quantity, satisfiedAmountTracker);
                allocation_plan.satisfied_demand.pinned.push({...req, satisfied_quantity: amountToSatisfy});
                satisfiedAmountTracker -= amountToSatisfy;
                if (amountToSatisfy < req.quantity){
                     allocation_plan.unsatisfied_demand.pinned.push({...req, unsatisfied_quantity: req.quantity - amountToSatisfy});
                }
            } else {
                allocation_plan.unsatisfied_demand.pinned.push({...req, unsatisfied_quantity: req.quantity});
            }
        });

        spotMarketState[clusterId] = {
            remaining_capacity: availableSupply - satisfiedPinned,
            current_demand: satisfiedPinned,
            allocated_floating: 0
        };
    }
    
    // B. Allocate Floating Demand
    let totalFloatingDemand = floatingDemandRequests.reduce((sum, req) => sum + req.quantity, 0);
    let floatingRequestsQueue = [...floatingDemandRequests];

    while (totalFloatingDemand > 0) {
        const currentPrices = {};
        let hasCapacity = false;

        for (const clusterId in CLUSTER_DATA) {
            if(spotMarketState[clusterId].remaining_capacity > 0){
                hasCapacity = true;
                // Price based on adding one more unit
                currentPrices[clusterId] = calculateSpotPriceForDemand(clusterId, spotMarketState[clusterId].current_demand + 1, CLUSTER_DATA);
            } else {
                currentPrices[clusterId] = Infinity;
            }
        }
        
        if (!hasCapacity) break; // No more capacity anywhere
        
        const cheapestClusterId = Object.keys(currentPrices).reduce((a, b) => currentPrices[a] < currentPrices[b] ? a : b);

        if (currentPrices[cheapestClusterId] === Infinity) break; // All remaining clusters are full

        // Allocate one unit of floating demand
        const currentRequest = floatingRequestsQueue[0];
        if (!currentRequest) break;
        
        const allocationAmount = 1;
        spotMarketState[cheapestClusterId].current_demand += allocationAmount;
        spotMarketState[cheapestClusterId].remaining_capacity -= allocationAmount;
        spotMarketState[cheapestClusterId].allocated_floating += allocationAmount;
        
        const existingAlloc = allocation_plan.satisfied_demand.floating.find(a => a.id === currentRequest.id);
        if(existingAlloc){
            if(!existingAlloc.allocations[cheapestClusterId]) existingAlloc.allocations[cheapestClusterId] = 0;
            existingAlloc.allocations[cheapestClusterId] += allocationAmount;
        } else {
            allocation_plan.satisfied_demand.floating.push({ ...currentRequest, allocations: {[cheapestClusterId]: allocationAmount} });
        }

        currentRequest.quantity -= allocationAmount;
        totalFloatingDemand -= allocationAmount;
        if(currentRequest.quantity <= 0) floatingRequestsQueue.shift();
    }

    // Any remaining requests in the queue are unsatisfied
     floatingRequestsQueue.forEach(req => {
        allocation_plan.unsatisfied_demand.floating.push({...req, unsatisfied_quantity: req.quantity});
     });


    // C. Finalize Spot Prices
    for (const clusterId in CLUSTER_DATA) {
        price_list.spot_prices[clusterId] = calculateSpotPriceForDemand(clusterId, spotMarketState[clusterId].current_demand, CLUSTER_DATA);
    }

    // --- 3. RENDER OUTPUTS ---
    renderPeriodCounter();
    renderClusterState(spotMarketState);
    renderPriceList(price_list);
    renderAllocationPlan(allocation_plan);

    // --- 4. CLEAN UP FOR NEXT PERIOD ---
    pinnedDemandRequests = [];
    floatingDemandRequests = [];
    renderDemandQueue();
}

// --- 2. UI RENDERING FUNCTIONS ---

function renderPeriodCounter() {
    periodCounterEl.textContent = periodCounter;
}

function renderDemandQueue() {
    demandQueueDisplay.innerHTML = '';
    if (pinnedDemandRequests.length === 0 && floatingDemandRequests.length === 0) {
        demandQueueDisplay.innerHTML = `<p class="text-gray-500">No requests added yet.</p>`;
        return;
    }

    pinnedDemandRequests.forEach(req => {
        const el = document.createElement('div');
        el.className = 'p-2 bg-indigo-50 rounded-md';
        el.innerHTML = `<strong>Pinned:</strong> ${req.quantity} units to <strong>${req.cluster}</strong> (ID: ${req.id})`;
        demandQueueDisplay.appendChild(el);
    });
    floatingDemandRequests.forEach(req => {
        const el = document.createElement('div');
        el.className = 'p-2 bg-emerald-50 rounded-md';
        el.innerHTML = `<strong>Floating:</strong> ${req.quantity} units (ID: ${req.id})`;
        demandQueueDisplay.appendChild(el);
    });
}

function renderClusterState(spotMarketState = null) {
    clusterStateDisplay.innerHTML = '';
    for(const clusterId in CLUSTER_DATA){
        const cluster = CLUSTER_DATA[clusterId];
        const availableSpot = cluster.total_capacity - cluster.guaranteed_sold;
        const pinnedDemand = (pinnedDemandRequests.filter(r => r.cluster === clusterId).reduce((s, r) => s + r.quantity, 0));
        const allocatedFloating = spotMarketState ? spotMarketState[clusterId].allocated_floating : 0;
        
        const el = document.createElement('div');
        el.className = 'p-4 bg-gray-100 rounded-lg space-y-2 border';
        el.innerHTML = `
            <h4 class="font-bold text-lg">${clusterId}</h4>
            <div>Total Capacity: <span class="font-medium">${cluster.total_capacity}</span></div>
            <div>Guaranteed Sold: <span class="font-medium">${cluster.guaranteed_sold}</span></div>
            <div class="font-semibold text-blue-600">Available Spot Supply: <span class="font-bold">${availableSpot}</span></div>
            <hr class="my-2">
            <div>Pinned Demand: <span class="font-medium text-indigo-700">${pinnedDemand}</span></div>
            <div class="mt-1">Allocated Floating: <span class="font-bold text-emerald-700">${allocatedFloating}</span></div>
        `;
        clusterStateDisplay.appendChild(el);
    }
}

function renderPriceList(priceList) {
    priceListDisplay.innerHTML = '';
    const guaranteedEl = document.createElement('div');
    guaranteedEl.innerHTML = '<h4 class="font-semibold text-gray-700">Guaranteed Prices (per Unit-Hour)</h4>';
    const spotEl = document.createElement('div');
    spotEl.innerHTML = '<h4 class="font-semibold text-gray-700 mt-3">Spot Prices (per Unit-Hour)</h4>';

    for(const clusterId in priceList.guaranteed_prices){
        guaranteedEl.innerHTML += `<div class="text-sm">${clusterId}: <span class="font-bold text-indigo-600">$${priceList.guaranteed_prices[clusterId].toFixed(4)}</span></div>`;
    }
     for(const clusterId in priceList.spot_prices){
        const price = isFinite(priceList.spot_prices[clusterId]) ? `$${priceList.spot_prices[clusterId].toFixed(4)}` : 'Unavailable';
        spotEl.innerHTML += `<div class="text-sm">${clusterId}: <span class="font-bold text-emerald-600">${price}</span></div>`;
    }
    priceListDisplay.appendChild(guaranteedEl);
    priceListDisplay.appendChild(spotEl);
}

function renderAllocationPlan(plan){
    allocationPlanDisplay.innerHTML = '';
    // Satisfied
    const satisfiedEl = document.createElement('div');
    satisfiedEl.innerHTML = '<h4 class="font-semibold text-green-700">Satisfied Demand</h4>';
    if(plan.satisfied_demand.pinned.length === 0 && plan.satisfied_demand.floating.length === 0){
        satisfiedEl.innerHTML += `<p class="text-sm text-gray-500">None</p>`;
    } else {
         plan.satisfied_demand.pinned.forEach(req => {
            satisfiedEl.innerHTML += `<div class="text-xs p-1 bg-green-50 rounded"><strong>Pinned #${req.id}:</strong> ${req.satisfied_quantity} units on <strong>${req.cluster}</strong></div>`;
        });
        plan.satisfied_demand.floating.forEach(req => {
            const allocs = Object.entries(req.allocations).map(([c, q]) => `<strong>${q}</strong> on <strong>${c}</strong>`).join(', ');
            satisfiedEl.innerHTML += `<div class="text-xs p-1 bg-green-50 rounded"><strong>Floating #${req.id}:</strong> ${allocs}</div>`;
        });
    }
    allocationPlanDisplay.appendChild(satisfiedEl);

    // Unsatisfied
    const unsatisfiedEl = document.createElement('div');
    unsatisfiedEl.innerHTML = '<h4 class="font-semibold text-red-700">Unsatisfied Demand</h4>';
     if(plan.unsatisfied_demand.pinned.length === 0 && plan.unsatisfied_demand.floating.length === 0){
        unsatisfiedEl.innerHTML += `<p class="text-sm text-gray-500">None</p>`;
    } else {
        plan.unsatisfied_demand.pinned.forEach(req => {
             unsatisfiedEl.innerHTML += `<div class="text-xs p-1 bg-red-50 rounded"><strong>Pinned #${req.id}:</strong> ${req.unsatisfied_quantity} units for <strong>${req.cluster}</strong></div>`;
        });
        plan.unsatisfied_demand.floating.forEach(req => {
             unsatisfiedEl.innerHTML += `<div class="text-xs p-1 bg-red-50 rounded"><strong>Floating #${req.id}:</strong> ${req.unsatisfied_quantity} units</div>`;
        });
    }
     allocationPlanDisplay.appendChild(unsatisfiedEl);
}

// --- 3. EVENT LISTENERS ---

addPinnedBtn.addEventListener('click', () => {
    const cluster = document.getElementById('pinned-cluster').value;
    const quantity = parseInt(document.getElementById('pinned-quantity').value, 10);
    if (quantity > 0) {
        requestIdCounter++;
        pinnedDemandRequests.push({ id: requestIdCounter, cluster, quantity });
        renderDemandQueue();
        renderClusterState(); // to update pinned demand display
    }
});

addFloatingBtn.addEventListener('click', () => {
    const quantity = parseInt(document.getElementById('floating-quantity').value, 10);
    if (quantity > 0) {
        requestIdCounter++;
        floatingDemandRequests.push({ id: requestIdCounter, quantity });
        renderDemandQueue();
    }
});

runAlgorithmBtn.addEventListener('click', runMarketClearingPeriod);

// --- 4. INITIAL RENDER ---
window.addEventListener('DOMContentLoaded', () => {
    renderPeriodCounter();
    renderDemandQueue();
    renderClusterState();
});