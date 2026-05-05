# ===== 1) 基本变量 =====
export REGISTRY="crpi-ba7wjcrt7x2afxv7.cn-hangzhou.personal.cr.aliyuncs.com"   # 或你的实例专属地址
export NAMESPACE="aliyun_caliu"
#export BACKEND_REPO="easy-agent-backend"
export FRONTEND_REPO="easy-agent-frontend"
export TAG="1.5"




## ===== 3) 给本地镜像打仓库标签 =====
#docker tag easy-agent/backend:latest  "$REGISTRY/$NAMESPACE/$BACKEND_REPO:$TAG"
#docker tag easy-agent/backend:latest  "$REGISTRY/$NAMESPACE/$BACKEND_REPO:latest"

docker tag easy-agent-frontend:"latest" "$REGISTRY/$NAMESPACE/$FRONTEND_REPO:$TAG"
#docker tag easy-agent/frontend:latest "$REGISTRY/$NAMESPACE/$FRONTEND_REPO:latest"

# ===== 4) 推送 =====
#docker push "$REGISTRY/$NAMESPACE/$BACKEND_REPO:$TAG"
#docker push "$REGISTRY/$NAMESPACE/$BACKEND_REPO:latest"

docker push "$REGISTRY/$NAMESPACE/$FRONTEND_REPO:$TAG"
#docker push "$REGISTRY/$NAMESPACE/$FRONTEND_REPO:latest"
