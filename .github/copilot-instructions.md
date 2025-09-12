# Copilot Instructions for AI Agents

## Project Overview
This repository implements a Kubernetes controller for a spot market auction system, focused on scheduling GPU-intensive jobs across clusters based on competitive bidding. The main logic is in `market-controller/market-auction-controller.go`, with the CRD schema in `market-controller/marketauctioncontroller.yaml`.

## Architecture & Data Flow
- **Custom Resource**: `MarketAuctionJob` (see CRD YAML) defines the job spec, bids (per cluster), and constraints.
- **Controller**: The Go controller watches `MarketAuctionJob` resources, runs an auction algorithm, and updates the resource status with the winning cluster, price, and schedule.
- **Auction Logic**: Bids are evaluated to select the lowest-price cluster that meets constraints. The result is written to the CRD status.
- **Extensibility**: The auction logic is currently simple (lowest price wins); see the `Reconcile` method for where to extend with more complex business rules.

## Key Files
- `market-controller/market-auction-controller.go`: Main controller logic, CRD Go structs, and reconciliation loop.
- `market-controller/marketauctioncontroller.yaml`: CRD definition for `MarketAuctionJob`.

## Developer Workflows
- **Build**: Standard Go build tools apply. Use `go build` in the `market-controller` directory.
- **Run/Debug**: Run the controller locally with access to a Kubernetes cluster. Use `kubectl` to apply CRDs and create `MarketAuctionJob` resources.
- **CRD Registration**: Apply the CRD YAML before running the controller: `kubectl apply -f market-controller/marketauctioncontroller.yaml`.
- **Testing**: No explicit test files found; add Go tests in the same directory for new logic.

## Project-Specific Conventions
- **Resource Naming**: All custom resources use the `bidspot.ai` group and are namespaced.
- **Status Updates**: Always update the CRD status subresource after auction logic.
- **Logging**: Use the controller-runtime logger for all reconciliation events.
- **RBAC**: Required permissions are annotated in the Go file with `+kubebuilder:rbac` comments.

## Integration Points
- **Kubernetes API**: Uses controller-runtime and client-go for all resource interactions.
- **Events**: Failure messages are recorded as Kubernetes events.

## Example Pattern
- To add a new auction rule, extend the logic in `Reconcile` (e.g., filter bids by `MaxTimeUntilStart` or add new constraints).

---

For questions about project structure or conventions, see the comments in `market-auction-controller.go` and the CRD YAML for authoritative patterns.
