# ML-Router Retraining Guide (v2.0)

This guide explains how to refine the Machine Learning model used by the `edge-gateway` for intelligent proxy selection.

## 1. Export Training Data
The gateway provides a live snapshot of node features via a debug endpoint. Run the following command from a machine that can reach the gateway:

```bash
curl http://localhost:8080/debug/ml/stats -o training_data.csv
```
The resulting `training_data.csv` contains 11 features per node, including the new **Domain Success Rate**.

## 2. Retrain the Model
Use the provided Python script to generate a new `.onnx` model.

**Prerequisites:**
- Python 3.8+
- `torch`, `onnx`, `numpy`

```bash
pip install torch onnx numpy
python scripts/train_router.py --data training_data.csv --output my_new_model.onnx
```

## 3. Deploy the New Model
The edge-gateway can load models dynamically via the `ML_MODEL_PATH` environment variable.

### Docker Compose
Update your `docker-compose.yml` or `.env` file:
```yaml
services:
  edge-gateway:
    environment:
      - ML_MODEL_PATH=/etc/proxyhubb/models/model.onnx
    volumes:
      - ./my_new_model.onnx:/etc/proxyhubb/models/model.onnx
```

### Direct Execution
```bash
export ML_MODEL_PATH="./my_new_model.onnx"
./edge-gateway
```

## 4. Verification
Check the gateway logs on startup to confirm the model was loaded successfully:
- `INFO: ONNX model loaded: ./my_new_model.onnx`
- If loading fails, it will log a warning and fallback to the **Heuristic Backend** automatically.

## Appendix: Feature Vector (11 Dimensions)
1.  `latency` (normalized)
2.  `connection_load` (% of max capacity)
3.  `bw_util` (bandwidth utilization)
4.  `success_rate` (historical)
5.  `avg_latency_hist` (EWMA)
6.  `packet_loss`
7.  `bytes_log` (log10 of total bytes served)
8.  `uptime_norm` (normalized uptime)
9.  `health` (binary)
10. `region_hash` (deterministic geo-hash)
11. `domain_success` (target-specific success rate)
