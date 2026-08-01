set -euo pipefail
TAG="$1"
OWNER="$2"
IMAGE="ghcr.io/${OWNER}/web:${TAG}"
LATEST="ghcr.io/${OWNER}/web:latest"
echo "Tagging local proxyhubb-web -> $IMAGE"
sudo docker tag proxyhubb-web:latest "$IMAGE"
sudo docker tag proxyhubb-web:latest "$LATEST"
echo "Logging into ghcr.io as '"$OWNER"'"
# token on stdin
sudo docker login ghcr.io -u '"$OWNER"' --password-stdin
echo "Pushing $IMAGE"
sudo docker push "$IMAGE"
echo "Pushing $LATEST"
sudo docker push "$LATEST"
echo PUSH_OK