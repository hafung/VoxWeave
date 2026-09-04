FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y python3 python3-pip libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
# matched stock torch+torchaudio (wheel bundles CUDA 13 runtime; GPU via nvidia runtime)
RUN pip install --break-system-packages --no-cache-dir torch torchaudio
RUN pip install --break-system-packages --no-cache-dir qwen-tts
WORKDIR /root/qwen-ft
