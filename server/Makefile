APP_NAME ?= noreplay
BIN_DIR ?= bin
BINARY ?= $(BIN_DIR)/$(APP_NAME)
MAIN_SRC ?= ./cmd/server

# Go toolchain options
GO ?= go
GOFLAGS ?= -trimpath
LDFLAGS ?= -s -w

# Local runtime defaults
ADDR ?= :8080
DATABASE_PATH ?= ./data/noreplay.db
SIGNUP_EMAIL ?=

# Container & Kubernetes options
IMAGE_NAME ?= noreplay:latest
K8S_DIR ?= deploy/k8s

.DEFAULT_GOAL := help

.PHONY: help all build run test test-v test-race test-cover vet fmt fmt-check check tidy clean docker-build k8s-dry-run

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

all: check build ## Run verification checks and build binary

build: ## Build the Go server binary (CGO-free)
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 $(GO) build $(GOFLAGS) -ldflags="$(LDFLAGS)" -o $(BINARY) $(MAIN_SRC)

run: ## Run server locally with environment defaults
	ADDR="$(ADDR)" DATABASE_PATH="$(DATABASE_PATH)" SIGNUP_EMAIL="$(SIGNUP_EMAIL)" $(GO) run $(MAIN_SRC)

test: ## Run unit and integration tests
	$(GO) test ./...

test-v: ## Run tests with verbose output
	$(GO) test -v ./...

test-race: ## Run tests with race detector enabled
	$(GO) test -race ./...

test-cover: ## Run tests and print coverage profile
	$(GO) test -coverprofile=coverage.out ./...
	$(GO) tool cover -func=coverage.out

vet: ## Run Go static analysis (go vet)
	$(GO) vet ./...

fmt: ## Format Go source files using gofmt
	gofmt -s -w .

fmt-check: ## Check Go formatting without modifying files
	@files=$$(gofmt -l .); if [ -n "$$files" ]; then \
		echo "Files require formatting (run 'make fmt'):"; \
		echo "$$files"; \
		exit 1; \
	fi

check: fmt-check vet test ## Run formatting check, go vet, and tests

tidy: ## Tidy and verify Go module dependencies
	$(GO) mod tidy
	$(GO) mod verify

clean: ## Clean build binaries and coverage outputs
	rm -rf $(BIN_DIR) coverage.out

docker-build: ## Build Docker container image
	docker build -t $(IMAGE_NAME) .

k8s-dry-run: ## Validate Kubernetes manifests with client-side dry run
	kubectl apply --dry-run=client -f $(K8S_DIR)
