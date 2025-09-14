// Set up the canvas and context
const canvas = document.getElementById('gpuCanvas');
const ctx = canvas.getContext('2d');

// --- Configuration for the cluster (will be updated from URL) ---
let CLUSTER_CONFIG = {
    numMachines: 9,
    gpusPerMachine: 8,
};

// Data structures for visualization
let machines = [];
const jobColors = ['#a78bfa', '#fcd34d', '#60a5fa', '#f87171', '#34d399'];
const jobNames = ['AI Training', 'Data Analysis', '3D Rendering', 'Neural Net', 'Cryptography'];

// DOM elements
const activeJobsEl = document.getElementById('activeJobs');
const throughputEl = document.getElementById('throughput');
const jobListEl = document.getElementById('jobList');
const utilizationChartEl = document.getElementById('utilizationChart');
const bandwidthChartEl = document.getElementById('bandwidthChart');
const incomingJobsQueueEl = document.getElementById('incomingJobsQueue');
const jobSummaryBoxEl = document.getElementById('jobSummaryBox');
const freeGpusSummaryEl = document.getElementById('freeGpusSummary');
const jobTypeDropdown = document.getElementById('jobTypeDropdown');
const jobCountInput = document.getElementById('jobCountInput');
const setJobsButton = document.getElementById('setJobsButton');
const messageText = document.getElementById('messageText');
const clusterIdDisplay = document.getElementById('cluster-id-display');
const manualControls = document.getElementById('manual-controls');

// Animation state
let animationId = null;
let intervalId = null;
let gpuUtilization = Array(totalGpus).fill(0);
let activeJobCount = 0;

// Job types definition
const jobTypes = {
    'AI Inference': { count: 0, gpusPerJob: 1, color: '#f87171' },
    'Training Batch': { count: 0, gpusPerJob: 4, color: '#34d399' },
    'Large Training': { count: 0, gpusPerJob: 8, color: '#a78bfa' }
};

// Mapping from simulator shape names to scheduler job names
const jobTypesMap = {
    'inference': 'AI Inference',
    'training_batch': 'Training Batch',
    'large_training': 'Large Training'
};

const freeColor = '#e5e7eb';

// Resize function for canvas
const resizeCanvas = () => {
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;
    updateGpuPositions();
    drawDashboard();
};

// Function to position GPUs dynamically
const updateGpuPositions = () => {
    const numMachines = CLUSTER_CONFIG.numMachines;
    const gpusPerMachine = CLUSTER_CONFIG.gpusPerMachine;
    const gpuRows = 2;
    const gpuCols = 4;
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const gpuSize = 15;
    const horizontalSpacing = 20;
    const verticalSpacing = 20;
    const gridWidth = (gpuCols * (gpuSize * 2)) + ((gpuCols - 1) * horizontalSpacing);
    const gridHeight = (gpuRows * (gpuSize * 2)) + ((gpuRows - 1) * verticalSpacing);
    const machineWidth = gridWidth + 60;
    const machineHeight = gridHeight + 60;

    const machineGridCols = Math.ceil(Math.sqrt(numMachines));
    const machineGridRows = Math.ceil(numMachines / machineGridCols);
    const machineBoxGap = 32;

    const totalClusterWidth = (machineWidth * machineGridCols) + (machineBoxGap * (machineGridCols - 1));
    const totalClusterHeight = (machineHeight * machineGridRows) + (machineBoxGap * (machineGridRows - 1));

    const startX = centerX - totalClusterWidth / 2;
    const startY = centerY - totalClusterHeight / 2;

    machines = [];
    for (let i = 0; i < numMachines; i++) {
        const machineRow = Math.floor(i / machineGridCols);
        const machineCol = i % machineGridCols;

        const machineX = startX + machineCol * (machineWidth + machineBoxGap);
        const machineY = startY + machineRow * (machineHeight + machineBoxGap);

        const machineGpus = [];
        for (let j = 0; j < gpusPerMachine; j++) {
            const row = Math.floor(j / gpuCols);
            const col = j % gpuCols;
            const gpuX = (machineX + 30) + (col * (gpuSize * 2 + horizontalSpacing)) + gpuSize;
            const gpuY = (machineY + 30) + (row * (gpuSize * 2 + verticalSpacing)) + gpuSize;
            machineGpus.push({ x: gpuX, y: gpuY, size: gpuSize, color: freeColor });
        }
        machines.push({ x: machineX, y: machineY, width: machineWidth, height: machineHeight, gpus: machineGpus });
    }
};

// Function to draw the dashboard
const drawDashboard = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    machines.forEach((machine, machineIndex) => {
        const boxX = machine.x;
        const boxY = machine.y;
        const borderRadius = 15;
        
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, machine.width, machine.height, borderRadius);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#d1d5db';
        ctx.font = '14px Orbitron';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Machine ${machineIndex + 1}`, boxX + machine.width / 2, boxY + 20);

        machine.gpus.forEach((gpu) => {
            ctx.beginPath();
            ctx.fillStyle = gpu.color;
            ctx.fillRect(gpu.x - gpu.size, gpu.y - gpu.size, gpu.size * 2, gpu.size * 2);
            ctx.fill();
        });
    });
};

// --- New Allocation and UI Functions ---

function updateUIData() {
    const totalGpus = CLUSTER_CONFIG.numMachines * CLUSTER_CONFIG.gpusPerMachine;
    const totalUsedGpus = Object.values(jobTypes).reduce((sum, job) => sum + job.count * job.gpusPerJob, 0);
    const freeGpus = totalGpus - totalUsedGpus;

    freeGpusSummaryEl.textContent = freeGpus;
    document.querySelector('#totalGpus').textContent = totalGpus;
    document.querySelector('#activeJobs').textContent = Object.values(jobTypes).reduce((sum, job) => sum + job.count, 0);
    document.querySelector('#vram').textContent = totalGpus * 8; // Assuming 8GB per GPU

    const summaryHTML = Object.keys(jobTypes).map(jobName => {
        const job = jobTypes[jobName];
        if (job.count === 0) return '';
        return `
            <div class="flex items-center gap-2 p-2 rounded-lg bg-gray-100">
                <div class="w-4 h-4 rounded-md" style="background-color: ${job.color};"></div>
                <div class="text-sm text-left">
                    <span class="font-bold">${jobName}</span>
                    <br>
                    <span class="text-gray-500">${job.count} jobs | ${job.count * job.gpusPerJob} GPUs</span>
                </div>
            </div>
        `;
    }).join('');
    jobSummaryBoxEl.innerHTML = summaryHTML || '<p class="text-gray-500">No jobs allocated.</p>';
}


function visualizeAllocation(demand) {
    // Reset machine state and job counts
    machines.forEach(machine => machine.gpus.forEach(gpu => gpu.color = freeColor));
    for (const jobName in jobTypes) { jobTypes[jobName].count = 0; }

    const machineAllocation = machines.map(() => []);

    demand.forEach(jobRequest => {
        const jobName = jobTypesMap[jobRequest.shape];
        if (!jobName) return;

        const jobDef = jobTypes[jobName];
        let placedJobs = 0;

        for (let i = 0; i < jobRequest.quantity; i++) {
            for (let m = 0; m < machines.length; m++) {
                const usedGpusOnMachine = machineAllocation[m].reduce((sum, job) => sum + job.gpusPerJob, 0);
                if ((CLUSTER_CONFIG.gpusPerMachine - usedGpusOnMachine) >= jobDef.gpusPerJob) {
                    machineAllocation[m].push(jobDef);
                    placedJobs++;
                    break;
                }
            }
        }
        jobTypes[jobName].count = placedJobs;
    });

    machineAllocation.forEach((jobs, machineIndex) => {
        let gpuIndex = 0;
        jobs.forEach(job => {
            for(let i = 0; i < job.gpusPerJob; i++) {
                if(gpuIndex < CLUSTER_CONFIG.gpusPerMachine) {
                    machines[machineIndex].gpus[gpuIndex].color = job.color;
                    gpuIndex++;
                }
            }
        });
    });
    
    updateUIData();
    drawDashboard();
}

// --- Initial Setup and Event Listeners ---
function initializeFromURL() {
    const params = new URLSearchParams(window.location.search);
    const clusterId = params.get('clusterId');
    const configParam = params.get('config');
    const demandParam = params.get('demand');

    if (clusterId && configParam && demandParam) {
        clusterIdDisplay.textContent = clusterId;
        try {
            const config = JSON.parse(decodeURIComponent(configParam));
            const demand = JSON.parse(decodeURIComponent(demandParam));

            CLUSTER_CONFIG.numMachines = config.numMachines;
            
            manualControls.style.display = 'none';

            resizeCanvas(); // Recalculate layout with new config
            visualizeAllocation(demand);

        } catch (e) {
            console.error("Error parsing URL parameters:", e);
            clusterIdDisplay.textContent = 'Error';
        }
    } else {
        clusterIdDisplay.textContent = 'Manual Mode';
        resizeCanvas();
        updateUIData();
        drawDashboard();
    }
}

setJobsButton.addEventListener('click', () => {
    const numJobs = parseInt(jobCountInput.value, 10);
    const jobType = jobTypeDropdown.value;
    
    if (!isNaN(numJobs) && numJobs >= 0) {
        jobTypes[jobType].count = numJobs; // Update one job type
        
        const demand = Object.entries(jobTypes).map(([name, data]) => {
            const shape = Object.keys(jobTypesMap).find(key => jobTypesMap[key] === name);
            return { shape: shape, quantity: data.count };
        });
        
        visualizeAllocation(demand);
    }
});


window.addEventListener('resize', resizeCanvas);
window.onload = initializeFromURL;

