# Please set huge page in host firstly

worker_address="X.X.X.X:Y" # 宿主机IP:端口，不能写127.0.0.1
etcd_address="X.X.X.X:2379" # etcd 所在宿主机IP:2379
enable_urma=0           # 是否启用URMA，0=不启用，1=启用
datasystem_use_brpc=false # 是否启用BRPC传输，true=启用，false=不启用

docker run -d \
  --name kv_worker \
  --restart=always \
  --privileged \
  --ipc=host \
  --net=host \
  -v /dev/shm:/dev/shm \
  -e worker_address=${worker_address} \
  -e etcd_address=${etcd_address} \
  -e enable_urma=${enable_urma} \
  -e DATASYSTEM_USE_BRPC=${datasystem_use_brpc} \
  kv_worker:latest
