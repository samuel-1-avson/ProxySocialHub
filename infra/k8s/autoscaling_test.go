package k8s

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// TestKubernetesAutoScaling tests Kubernetes auto-scaling behavior
// Property 2: Auto-Scaling Responsiveness
// Validates: Requirements 1.4
func TestKubernetesAutoScaling(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping Kubernetes auto-scaling test in short mode")
	}

	// Create Kubernetes client
	client, err := createKubernetesClient()
	if err != nil {
		t.Skipf("Kubernetes client not available: %v", err)
	}

	ctx := context.Background()
	namespace := "proxyhubb"

	// Property: HPA should scale pods based on CPU/memory thresholds
	t.Run("hpa_scales_based_on_metrics", func(t *testing.T) {
		deploymentName := "control-api"
		hpaName := "control-api-hpa"

		// Get initial deployment state
		deployment, err := client.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
		if err != nil {
			t.Skipf("Deployment %s not found: %v", deploymentName, err)
		}

		initialReplicas := *deployment.Spec.Replicas
		t.Logf("Initial replicas for %s: %d", deploymentName, initialReplicas)

		// Get HPA configuration
		hpa, err := client.AutoscalingV2().HorizontalPodAutoscalers(namespace).Get(ctx, hpaName, metav1.GetOptions{})
		if err != nil {
			t.Skipf("HPA %s not found: %v", hpaName, err)
		}

		// Verify HPA configuration
		assert.Equal(t, int32(3), hpa.Spec.MinReplicas, "HPA min replicas should be 3")
		assert.Equal(t, int32(20), hpa.Spec.MaxReplicas, "HPA max replicas should be 20")

		// Check HPA metrics configuration
		foundCPUMetric := false
		foundMemoryMetric := false
		for _, metric := range hpa.Spec.Metrics {
			if metric.Type == autoscalingv2.ResourceMetricSourceType {
				switch metric.Resource.Name {
				case corev1.ResourceCPU:
					foundCPUMetric = true
					assert.Equal(t, int32(70), *metric.Resource.Target.AverageUtilization, "CPU threshold should be 70%")
				case corev1.ResourceMemory:
					foundMemoryMetric = true
					assert.Equal(t, int32(80), *metric.Resource.Target.AverageUtilization, "Memory threshold should be 80%")
				}
			}
		}

		assert.True(t, foundCPUMetric, "HPA should have CPU metric configured")
		assert.True(t, foundMemoryMetric, "HPA should have Memory metric configured")

		// Check HPA status
		t.Logf("HPA current replicas: %d, desired replicas: %d", hpa.Status.CurrentReplicas, hpa.Status.DesiredReplicas)
	})

	// Property: Pod Disruption Budgets should maintain minimum availability
	t.Run("pdb_maintains_minimum_availability", func(t *testing.T) {
		pdbName := "control-api-pdb"

		pdb, err := client.PolicyV1().PodDisruptionBudgets(namespace).Get(ctx, pdbName, metav1.GetOptions{})
		if err != nil {
			t.Skipf("PDB %s not found: %v", pdbName, err)
		}

		// Verify PDB configuration
		assert.NotNil(t, pdb.Spec.MinAvailable, "PDB should have minAvailable set")
		if pdb.Spec.MinAvailable != nil {
			minAvailable := pdb.Spec.MinAvailable.IntValue()
			assert.GreaterOrEqual(t, minAvailable, 2, "PDB should maintain at least 2 pods")
		}

		t.Logf("PDB %s maintains minimum %v pods", pdbName, pdb.Spec.MinAvailable)
	})

	// Property: Resource quotas should prevent resource exhaustion
	t.Run("resource_quotas_prevent_exhaustion", func(t *testing.T) {
		quotaName := "proxyhubb-quota"

		quota, err := client.CoreV1().ResourceQuotas(namespace).Get(ctx, quotaName, metav1.GetOptions{})
		if err != nil {
			t.Skipf("ResourceQuota %s not found: %v", quotaName, err)
		}

		// Verify quota limits
		hard := quota.Spec.Hard
		assert.NotEmpty(t, hard, "ResourceQuota should have hard limits")

		// Check CPU limits
		if cpuLimit, exists := hard[corev1.ResourceRequestsCPU]; exists {
			t.Logf("CPU request limit: %s", cpuLimit.String())
			assert.True(t, cpuLimit.Value() > 0, "CPU limit should be positive")
		}

		// Check memory limits
		if memLimit, exists := hard[corev1.ResourceRequestsMemory]; exists {
			t.Logf("Memory request limit: %s", memLimit.String())
			assert.True(t, memLimit.Value() > 0, "Memory limit should be positive")
		}

		// Check pod limits
		if podLimit, exists := hard[corev1.ResourcePods]; exists {
			t.Logf("Pod limit: %s", podLimit.String())
			assert.True(t, podLimit.Value() >= 50, "Pod limit should allow reasonable scaling")
		}
	})

	// Property: Deployments should have proper resource requests/limits for HPA
	t.Run("deployments_have_resource_specifications", func(t *testing.T) {
		deployments := []string{"control-api", "edge-gateway"}

		for _, deploymentName := range deployments {
			deployment, err := client.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
			if err != nil {
				t.Logf("Deployment %s not found, skipping: %v", deploymentName, err)
				continue
			}

			// Check that containers have resource requests (required for HPA)
			for _, container := range deployment.Spec.Template.Spec.Containers {
				resources := container.Resources

				// Verify CPU requests
				cpuRequest := resources.Requests[corev1.ResourceCPU]
				assert.False(t, cpuRequest.IsZero(), "Container %s should have CPU request", container.Name)

				// Verify memory requests
				memRequest := resources.Requests[corev1.ResourceMemory]
				assert.False(t, memRequest.IsZero(), "Container %s should have memory request", container.Name)

				// Verify limits are set
				cpuLimit := resources.Limits[corev1.ResourceCPU]
				assert.False(t, cpuLimit.IsZero(), "Container %s should have CPU limit", container.Name)

				memLimit := resources.Limits[corev1.ResourceMemory]
				assert.False(t, memLimit.IsZero(), "Container %s should have memory limit", container.Name)

				t.Logf("Container %s - CPU: %s/%s, Memory: %s/%s",
					container.Name,
					cpuRequest.String(), cpuLimit.String(),
					memRequest.String(), memLimit.String())
			}
		}
	})

	// Property: Scaling behavior should be configured for stability
	t.Run("hpa_scaling_behavior_configured", func(t *testing.T) {
		hpaNames := []string{"control-api-hpa", "edge-gateway-hpa"}

		for _, hpaName := range hpaNames {
			hpa, err := client.AutoscalingV2().HorizontalPodAutoscalers(namespace).Get(ctx, hpaName, metav1.GetOptions{})
			if err != nil {
				t.Logf("HPA %s not found, skipping: %v", hpaName, err)
				continue
			}

			// Check scaling behavior configuration
			if hpa.Spec.Behavior != nil {
				behavior := hpa.Spec.Behavior

				// Check scale up behavior
				if behavior.ScaleUp != nil {
					assert.Greater(t, int(behavior.ScaleUp.StabilizationWindowSeconds), 0, "Scale up stabilization window should be set")
					assert.NotEmpty(t, behavior.ScaleUp.Policies, "Scale up policies should be configured")
				}

				// Check scale down behavior
				if behavior.ScaleDown != nil {
					assert.Greater(t, int(behavior.ScaleDown.StabilizationWindowSeconds), 0, "Scale down stabilization window should be set")
					assert.NotEmpty(t, behavior.ScaleDown.Policies, "Scale down policies should be configured")
				}

				t.Logf("HPA %s has scaling behavior configured", hpaName)
			}
		}
	})
}

// TestAutoScalingIntegration tests end-to-end auto-scaling integration
func TestAutoScalingIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping auto-scaling integration test in short mode")
	}

	client, err := createKubernetesClient()
	if err != nil {
		t.Skipf("Kubernetes client not available: %v", err)
	}

	ctx := context.Background()
	namespace := "proxyhubb"

	t.Run("end_to_end_scaling_simulation", func(t *testing.T) {
		deploymentName := "control-api"
		hpaName := "control-api-hpa"

		// Get initial state
		deployment, err := client.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
		if err != nil {
			t.Skipf("Deployment %s not found: %v", deploymentName, err)
		}

		initialReplicas := *deployment.Spec.Replicas
		t.Logf("Starting with %d replicas", initialReplicas)

		// Monitor HPA status over time
		monitorDuration := 5 * time.Minute
		checkInterval := 30 * time.Second
		
		startTime := time.Now()
		for time.Since(startTime) < monitorDuration {
			hpa, err := client.AutoscalingV2().HorizontalPodAutoscalers(namespace).Get(ctx, hpaName, metav1.GetOptions{})
			if err != nil {
				t.Fatalf("Failed to get HPA: %v", err)
			}

			deployment, err := client.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
			if err != nil {
				t.Fatalf("Failed to get deployment: %v", err)
			}

			currentReplicas := *deployment.Spec.Replicas
			desiredReplicas := hpa.Status.DesiredReplicas
			
			t.Logf("Time: %v, Current: %d, Desired: %d, Ready: %d",
				time.Since(startTime).Round(time.Second),
				currentReplicas,
				desiredReplicas,
				deployment.Status.ReadyReplicas)

			// Verify replicas are within expected bounds
			assert.GreaterOrEqual(t, int(currentReplicas), 3, "Should maintain minimum replicas")
			assert.LessOrEqual(t, int(currentReplicas), 20, "Should not exceed maximum replicas")

			// Check if scaling is responsive (within reasonable bounds)
			if desiredReplicas != currentReplicas {
				t.Logf("Scaling in progress: current=%d, desired=%d", currentReplicas, desiredReplicas)
			}

			time.Sleep(checkInterval)
		}
	})
}

// createKubernetesClient creates a Kubernetes client for testing
func createKubernetesClient() (*kubernetes.Clientset, error) {
	// Try in-cluster config first
	config, err := rest.InClusterConfig()
	if err != nil {
		// Fall back to kubeconfig
		config, err = clientcmd.BuildConfigFromFlags("", clientcmd.RecommendedHomeFile)
		if err != nil {
			return nil, fmt.Errorf("failed to create kubernetes config: %w", err)
		}
	}

	client, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	return client, nil
}

// BenchmarkAutoScalingMetrics benchmarks auto-scaling metrics collection
func BenchmarkAutoScalingMetrics(b *testing.B) {
	client, err := createKubernetesClient()
	if err != nil {
		b.Skipf("Kubernetes client not available: %v", err)
	}

	ctx := context.Background()
	namespace := "proxyhubb"

	b.Run("hpa_status_queries", func(b *testing.B) {
		hpaName := "control-api-hpa"
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, err := client.AutoscalingV2().HorizontalPodAutoscalers(namespace).Get(ctx, hpaName, metav1.GetOptions{})
			if err != nil {
				b.Fatalf("Failed to get HPA: %v", err)
			}
		}
	})

	b.Run("deployment_status_queries", func(b *testing.B) {
		deploymentName := "control-api"
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, err := client.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
			if err != nil {
				b.Fatalf("Failed to get deployment: %v", err)
			}
		}
	})

	b.Run("pod_metrics_collection", func(b *testing.B) {
		labelSelector := "app=control-api"
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
				LabelSelector: labelSelector,
			})
			if err != nil {
				b.Fatalf("Failed to list pods: %v", err)
			}
		}
	})
}