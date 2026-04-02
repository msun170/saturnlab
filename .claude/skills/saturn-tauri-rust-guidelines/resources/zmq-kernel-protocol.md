# Jupyter Wire Protocol (ZeroMQ)

## Channel Setup

Each kernel exposes 5 ZMQ sockets. Connection info is in `kernel-{pid}.json`:

```json
{
  "transport": "tcp",
  "ip": "127.0.0.1",
  "shell_port": 52340,
  "iopub_port": 52341,
  "stdin_port": 52342,
  "control_port": 52343,
  "hb_port": 52344,
  "key": "a-]6P2d59",
  "signature_scheme": "hmac-sha256",
  "kernel_name": "python3"
}
```

Socket types:
- **shell**: DEALER socket (client) ↔ ROUTER socket (kernel) — request/reply for execution
- **iopub**: SUB socket (client subscribes) — broadcast channel for outputs, status
- **stdin**: DEALER socket — kernel asks for user input (e.g., `input()`)
- **control**: DEALER socket — interrupt, shutdown (high priority, bypasses shell queue)
- **heartbeat**: REQ socket — simple echo ping to check kernel is alive

## Message Wire Format

ZMQ multipart message:
```
[identity]           # ZMQ routing identity (DEALER/ROUTER)
b'<IDS|MSG>'         # delimiter
HMAC signature       # HMAC-SHA256 of header+parent+metadata+content
header               # JSON
parent_header        # JSON
metadata             # JSON
content              # JSON
[extra_buffers]      # optional binary buffers (for widgets)
```

## HMAC Signing

```rust
use hmac::{Hmac, Mac};
use sha2::Sha256;

fn sign_message(key: &[u8], parts: &[&[u8]]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).unwrap();
    for part in parts {
        mac.update(part);
    }
    hex::encode(mac.finalize().into_bytes())
}
```

## Key Message Types

### execute_request (shell channel)
```json
{
  "header": { "msg_type": "execute_request", "msg_id": "uuid", "session": "uuid" },
  "content": {
    "code": "print('hello')",
    "silent": false,
    "store_history": true,
    "allow_stdin": true
  }
}
```

### execute_reply (shell channel)
```json
{
  "content": {
    "status": "ok",
    "execution_count": 1
  }
}
```

### stream (iopub channel) — stdout/stderr
```json
{
  "header": { "msg_type": "stream" },
  "content": { "name": "stdout", "text": "hello\n" }
}
```

### display_data (iopub channel) — rich output
```json
{
  "header": { "msg_type": "display_data" },
  "content": {
    "data": {
      "text/plain": "<Figure>",
      "image/png": "iVBORw0KGgo...",
      "text/html": "<img src='...'>"
    },
    "metadata": {}
  }
}
```

### error (iopub channel)
```json
{
  "header": { "msg_type": "error" },
  "content": {
    "ename": "NameError",
    "evalue": "name 'foo' is not defined",
    "traceback": [
      "\u001b[0;31m-----------\u001b[0m",
      "\u001b[0;31mNameError\u001b[0m: name 'foo' is not defined"
    ]
  }
}
```

### status (iopub channel)
```json
{
  "content": { "execution_state": "busy" }
}
```
States: `busy` → `idle` (after execution), `starting` (kernel launching)

### complete_request (shell) — autocomplete
```json
{
  "content": { "code": "import pa", "cursor_pos": 9 }
}
```
Reply: `{ "matches": ["pandas", "pathlib"], "cursor_start": 7, "cursor_end": 9, "status": "ok" }`

### inspect_request (shell) — tooltip
```json
{
  "content": { "code": "pd.read_csv", "cursor_pos": 11, "detail_level": 0 }
}
```

### interrupt_request (control channel)
```json
{ "header": { "msg_type": "interrupt_request" }, "content": {} }
```

### shutdown_request (control channel)
```json
{ "content": { "restart": false } }
```

## Kernel Lifecycle

1. **Discovery**: Read `kernel.json` from kernelspec directories
2. **Launch**: Create connection file with random ports → spawn kernel process with `--KernelApp.connection_file=<path>`
3. **Connect**: Open 5 ZMQ sockets to the ports in connection file
4. **Heartbeat**: Start REQ/REP echo loop (send ping, expect pong)
5. **Execute**: Send execute_request on shell, listen iopub for outputs
6. **Interrupt**: Send interrupt_request on control channel (or SIGINT on Unix)
7. **Shutdown**: Send shutdown_request on control, wait for process exit, clean up connection file

## Kernelspec Discovery Paths

**Linux/macOS:**
- `~/.local/share/jupyter/kernels/`
- `/usr/local/share/jupyter/kernels/`
- `/usr/share/jupyter/kernels/`
- `{sys.prefix}/share/jupyter/kernels/` (conda/venv)

**Windows:**
- `%APPDATA%\jupyter\kernels\`
- `%PROGRAMDATA%\jupyter\kernels\`
- `{sys.prefix}\share\jupyter\kernels\` (conda/venv)

Each kernelspec is a directory containing `kernel.json`:
```json
{
  "display_name": "Python 3",
  "language": "python",
  "argv": ["python", "-m", "ipykernel_launcher", "-f", "{connection_file}"]
}
```
