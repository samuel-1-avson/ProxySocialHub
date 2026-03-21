import socket

def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('127.0.0.1', 8443))
    server.listen(1)
    print("Mock server listening on 127.0.0.1:8443")
    
    conn, addr = server.accept()
    print(f"Connected by {addr}")
    
    while True:
        data = conn.recv(1024)
        if not data:
            break
        print(f"Received: {data}")
        conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nHI")
    
    conn.close()

if __name__ == "__main__":
    main()
