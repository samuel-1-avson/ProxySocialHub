# Testing Guide

This document outlines the testing strategy, frameworks, and best practices for the ProxyHubb system.

## Table of Contents

- [Testing Strategy](#testing-strategy)
- [Testing Levels](#testing-levels)
- [Test Frameworks](#test-frameworks)
- [Running Tests](#running-tests)
- [Test Coverage](#test-coverage)
- [Best Practices](#best-practices)
- [CI/CD Integration](#cicd-integration)

---

## Testing Strategy

Our testing strategy follows the testing pyramid:

```
         /\
        /  \
       / E2E \          <- Few tests (critical paths)
      /________\
     /          \
    / Integration \      <- Medium tests (service boundaries)
   /______________\
  /                \
 /     Unit Tests    \   <- Many tests (business logic)
/______________________\
```

### Goals

- **Unit Tests**: 80%+ coverage for business logic
- **Integration Tests**: Cover all external service boundaries
- **E2E Tests**: Cover critical user journeys
- **Contract Tests**: Verify API contracts between services

---

## Testing Levels

### 1. Unit Tests

Test individual functions and methods in isolation.

**Location**: Next to source files (`*_test.go`, `*.test.ts`, etc.)

**Examples**:
```go
// services/control-api/internal/api/auth_test.go
func TestValidatePassword(t *testing.T) {
    tests := []struct {
        name     string
        password string
        wantErr  bool
    }{
        {"valid", "StrongP@ssw0rd", false},
        {"too short", "weak", true},
        {"no number", "WeakPassword", true},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidatePassword(tt.password)
            if (err != nil) != tt.wantErr {
                t.Errorf("ValidatePassword() error = %v, wantErr %v", err, tt.wantErr)
            }
        })
    }
}
```

### 2. Integration Tests

Test interaction between components and external services.

**Location**: `tests/integration/`

**Examples**:
```go
// Test database integration
func TestUserRepository_Create(t *testing.T) {
    db := testutil.NewTestDB(t)
    repo := db.NewUserRepository()
    
    user := &models.User{Email: "test@example.com"}
    err := repo.Create(user)
    
    assert.NoError(t, err)
    assert.NotNil(t, user.ID)
}
```

### 3. E2E Tests

Test complete user flows using real browsers.

**Location**: `apps/web/e2e/`

**Framework**: Playwright

**Examples**:
```typescript
// apps/web/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test('user can login', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name=email]', 'user@example.com');
  await page.fill('[name=password]', 'password');
  await page.click('button[type=submit]');
  
  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('text=Welcome')).toBeVisible();
});
```

### 4. Contract Tests

Verify API contracts between services.

**Framework**: Pact

**Location**: `tests/contracts/`

---

## Test Frameworks

### Go (Control API)

| Framework | Purpose | Usage |
|-----------|---------|-------|
| `testing` | Standard library | Unit tests |
| `testify` | Assertions, mocks | `assert`, `require`, `mock` |
| `httptest` | HTTP testing | Handler tests |
| `testcontainers-go` | Integration | Database tests |

#### Mocking with Testify

```go
import "github.com/stretchr/testify/mock"

// Define mock
type MockUserRepository struct {
    mock.Mock
}

func (m *MockUserRepository) FindByID(id uuid.UUID) (*models.User, error) {
    args := m.Called(id)
    return args.Get(0).(*models.User), args.Error(1)
}

// Use in test
func TestGetUser(t *testing.T) {
    mockRepo := new(MockUserRepository)
    mockRepo.On("FindByID", uuid.MustParse("...")).Return(&models.User{...}, nil)
    
    service := NewUserService(mockRepo)
    user, err := service.GetUser("...")
    
    assert.NoError(t, err)
    mockRepo.AssertExpectations(t)
}
```

### TypeScript (Frontend)

| Framework | Purpose | Usage |
|-----------|---------|-------|
| Jest | Unit testing | Components, utilities |
| React Testing Library | Component testing | User interaction |
| Playwright | E2E testing | Full workflows |
| MSW | API mocking | Network interception |

#### Component Testing

```typescript
// components/Button.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

test('button calls onClick when clicked', () => {
  const handleClick = jest.fn();
  render(<Button onClick={handleClick}>Click me</Button>);
  
  fireEvent.click(screen.getByText('Click me'));
  expect(handleClick).toHaveBeenCalledTimes(1);
});
```

### Rust (Edge Gateway)

| Framework | Purpose | Usage |
|-----------|---------|-------|
| `tokio::test` | Async testing | Unit tests |
| `mockall` | Mocking | External services |
| `reqwest` | HTTP testing | Integration tests |

---

## Running Tests

### Go Tests

```bash
cd services/control-api

# Run all tests
go test ./...

# Run with coverage
go test -cover ./...

# Run with race detection
go test -race ./...

# Run specific test
go test -run TestAuth ./internal/api/

# Generate coverage report
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out -o coverage.html
```

### Frontend Tests

```bash
cd apps/web

# Run unit tests
npm test

# Run with coverage
npm test -- --coverage

# Run E2E tests
npm run test:e2e

# Run E2E with UI
npx playwright test --ui
```

### Rust Tests

```bash
cd services/edge-gateway

# Run all tests
cargo test

# Run with output
cargo test -- --nocapture

# Run specific test
cargo test test_name

# Check without running
cargo check
```

### Solana Program Tests

```bash
cd services/solana-programs/proxyhub

# Run Anchor tests
anchor test

# Run with logs
anchor test -- --nocapture
```

### All Tests (Docker)

```bash
# Run all tests in containers
docker-compose -f docker-compose.test.yml up --abort-on-container-exit
```

---

## Test Coverage

### Coverage Goals

| Component | Target | Current |
|-----------|--------|---------|
| Control API (Go) | 80% | TBD |
| Web Frontend | 70% | TBD |
| Edge Gateway | 70% | TBD |
| Solana Programs | 90% | TBD |

### Viewing Coverage Reports

Coverage reports are generated in CI and uploaded to Codecov:

```bash
# Generate local coverage
go test -coverprofile=coverage.out ./...

# View in browser
go tool cover -html=coverage.out
```

### Coverage Badge

Add to README:

```markdown
[![Coverage](https://codecov.io/gh/your-org/proxyhubb/branch/main/graph/badge.svg)](https://codecov.io/gh/your-org/proxyhubb)
```

---

## Best Practices

### 1. Test Naming

```go
// Good: describes behavior
func TestCalculateTotal_AppliesDiscount_WhenPremiumUser(t *testing.T) {}

// Bad: doesn't describe behavior
func TestCalc1(t *testing.T) {}
```

### 2. Arrange-Act-Assert

```go
func TestUserService_Create(t *testing.T) {
    // Arrange
    repo := new(MockUserRepository)
    service := NewUserService(repo)
    input := &CreateUserInput{Email: "test@example.com"}
    
    // Act
    user, err := service.Create(input)
    
    // Assert
    assert.NoError(t, err)
    assert.NotNil(t, user)
    assert.Equal(t, input.Email, user.Email)
}
```

### 3. Table-Driven Tests

```go
func TestValidateEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        isValid bool
    }{
        {"valid email", "test@example.com", true},
        {"no @ symbol", "testexample.com", false},
        {"no domain", "test@", false},
        {"empty", "", false},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := ValidateEmail(tt.email)
            assert.Equal(t, tt.isValid, got)
        })
    }
}
```

### 4. Test Isolation

```go
func TestUserRepository(t *testing.T) {
    // Each test gets a clean database
    db := testutil.NewTestDB(t)
    t.Cleanup(func() {
        db.Cleanup()
    })
    
    // Test code...
}
```

### 5. Don't Test Implementation Details

```typescript
// Good: tests behavior
expect(screen.getByText('User created')).toBeVisible();

// Bad: tests implementation
expect(wrapper.find('.success-message').exists()).toBe(true);
```

---

## Test Utilities

### Go Test Utilities

```go
// internal/testutil/testutil.go
package testutil

import "testing"

func NewTestDB(t *testing.T) *TestDB {
    // Setup test database
    db := // ...
    
    t.Cleanup(func() {
        // Cleanup
        db.Drop()
    })
    
    return db
}

func MustParseUUID(t *testing.T, s string) uuid.UUID {
    t.Helper()
    id, err := uuid.Parse(s)
    if err != nil {
        t.Fatalf("failed to parse UUID: %v", err)
    }
    return id
}
```

### Frontend Test Utilities

```typescript
// lib/test-utils.tsx
import { render as rtlRender } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function render(ui: React.ReactElement, options = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
    options
  );
}
```

---

## CI/CD Integration

Tests run automatically on:

1. **Pull Requests**: All tests must pass
2. **Main Branch**: Full test suite + coverage
3. **Nightly**: Extended integration tests
4. **Release**: Full regression suite

### Test Matrix

| Job | Go | Node | Rust | Postgres | Redis |
|-----|----|----|----|----|----|
| Unit | 1.24 | 20 | stable | - | - |
| Integration | 1.24 | 20 | stable | 15 | 7 |
| E2E | - | 20 | - | 15 | 7 |

### Test Reports

JUnit XML reports are generated for CI:

```bash
# Go
go test -v -json ./... > test-report.json

# Jest
npm test -- --reporters=jest-junit
```

---

## Debugging Tests

### Go

```bash
# Run with debugger
dlv test ./internal/api

# Add breakpoints in code
runtime.Breakpoint()
```

### Frontend

```bash
# Debug mode
npm test -- --verbose

# Single test
npm test -- --testNamePattern="Auth"

# With debugger
node --inspect-brk node_modules/.bin/jest --runInBand
```

---

## Resources

- [Go Testing](https://golang.org/pkg/testing/)
- [Testify](https://github.com/stretchr/testify)
- [Jest Documentation](https://jestjs.io/)
- [Playwright](https://playwright.dev/)
- [Rust Testing](https://doc.rust-lang.org/book/ch11-00-testing.html)
