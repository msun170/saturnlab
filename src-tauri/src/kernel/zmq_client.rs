use crate::kernel::message::JupyterMessage;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use zeromq::{DealerSocket, Socket, SocketRecv, SocketSend, SubSocket};

/// Connection info from the kernel's connection file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub transport: String,
    pub ip: String,
    pub shell_port: u16,
    pub iopub_port: u16,
    pub stdin_port: u16,
    pub control_port: u16,
    pub hb_port: u16,
    pub key: String,
    pub signature_scheme: String,
    #[serde(default)]
    pub kernel_name: String,
}

impl ConnectionInfo {
    /// Read connection info from a JSON file.
    pub fn from_file(path: &PathBuf) -> Result<Self, String> {
        let contents =
            std::fs::read_to_string(path).map_err(|e| format!("Read connection file: {}", e))?;
        serde_json::from_str(&contents).map_err(|e| format!("Parse connection file: {}", e))
    }

    /// Generate a new connection file with random ports.
    pub fn generate(kernel_name: &str) -> Self {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let base_port: u16 = rng.gen_range(49152..60000);

        Self {
            transport: "tcp".to_string(),
            ip: "127.0.0.1".to_string(),
            shell_port: base_port,
            iopub_port: base_port + 1,
            stdin_port: base_port + 2,
            control_port: base_port + 3,
            hb_port: base_port + 4,
            key: uuid::Uuid::new_v4().to_string(),
            signature_scheme: "hmac-sha256".to_string(),
            kernel_name: kernel_name.to_string(),
        }
    }

    /// Write connection info to a JSON file.
    pub fn write_to_file(&self, path: &PathBuf) -> Result<(), String> {
        let contents =
            serde_json::to_string_pretty(self).map_err(|e| format!("Serialize: {}", e))?;
        std::fs::write(path, contents).map_err(|e| format!("Write: {}", e))
    }

    fn endpoint(&self, port: u16) -> String {
        format!("{}://{}:{}", self.transport, self.ip, port)
    }
}

/// Shell-only ZMQ client for sending execute requests.
/// Does NOT connect to iopub — that's handled by IopubListener.
pub struct ShellClient {
    pub shell: DealerSocket,
    pub control: DealerSocket,
    pub connection: ConnectionInfo,
}

impl ShellClient {
    /// Connect shell and control channels only (no iopub).
    pub async fn connect(conn: ConnectionInfo) -> Result<Self, String> {
        let mut shell = DealerSocket::new();
        shell
            .connect(&conn.endpoint(conn.shell_port))
            .await
            .map_err(|e| format!("Shell connect: {}", e))?;

        let mut control = DealerSocket::new();
        control
            .connect(&conn.endpoint(conn.control_port))
            .await
            .map_err(|e| format!("Control connect: {}", e))?;

        Ok(Self {
            shell,
            control,
            connection: conn,
        })
    }

    /// Send a message on the shell channel.
    pub async fn send_shell(&mut self, msg: &JupyterMessage) -> Result<(), String> {
        let frames = msg.to_wire_frames(self.connection.key.as_bytes());
        let zmq_msg = frames_to_zmq_message(frames);
        self.shell
            .send(zmq_msg)
            .await
            .map_err(|e| format!("Shell send: {}", e))
    }

    /// Send a message on the control channel.
    pub async fn send_control(&mut self, msg: &JupyterMessage) -> Result<(), String> {
        let frames = msg.to_wire_frames(self.connection.key.as_bytes());
        let zmq_msg = frames_to_zmq_message(frames);
        self.control
            .send(zmq_msg)
            .await
            .map_err(|e| format!("Control send: {}", e))
    }
}

/// Dedicated iopub listener — exactly ONE per kernel.
pub struct IopubListener {
    pub iopub: SubSocket,
    pub connection: ConnectionInfo,
}

impl IopubListener {
    /// Connect to the iopub channel only.
    pub async fn connect(conn: ConnectionInfo) -> Result<Self, String> {
        let mut iopub = SubSocket::new();
        iopub
            .connect(&conn.endpoint(conn.iopub_port))
            .await
            .map_err(|e| format!("IOPub connect: {}", e))?;
        iopub
            .subscribe("")
            .await
            .map_err(|e| format!("IOPub subscribe: {}", e))?;

        Ok(Self {
            iopub,
            connection: conn,
        })
    }

    /// Receive the next message from the iopub channel.
    pub async fn recv(&mut self) -> Result<JupyterMessage, String> {
        let zmq_msg = self
            .iopub
            .recv()
            .await
            .map_err(|e| format!("IOPub recv: {}", e))?;
        let frames = zmq_message_to_frames(zmq_msg);
        JupyterMessage::from_wire_frames(&frames, self.connection.key.as_bytes())
    }
}

/// For backwards compat — full client with all channels.
pub struct ZmqClient {
    pub shell: DealerSocket,
    pub iopub: SubSocket,
    pub control: DealerSocket,
    pub connection: ConnectionInfo,
}

impl ZmqClient {
    pub async fn connect(conn: ConnectionInfo) -> Result<Self, String> {
        let mut shell = DealerSocket::new();
        shell
            .connect(&conn.endpoint(conn.shell_port))
            .await
            .map_err(|e| format!("Shell connect: {}", e))?;

        let mut iopub = SubSocket::new();
        iopub
            .connect(&conn.endpoint(conn.iopub_port))
            .await
            .map_err(|e| format!("IOPub connect: {}", e))?;
        iopub
            .subscribe("")
            .await
            .map_err(|e| format!("IOPub subscribe: {}", e))?;

        let mut control = DealerSocket::new();
        control
            .connect(&conn.endpoint(conn.control_port))
            .await
            .map_err(|e| format!("Control connect: {}", e))?;

        Ok(Self {
            shell,
            iopub,
            control,
            connection: conn,
        })
    }

    pub async fn send_shell(&mut self, msg: &JupyterMessage) -> Result<(), String> {
        let frames = msg.to_wire_frames(self.connection.key.as_bytes());
        let zmq_msg = frames_to_zmq_message(frames);
        self.shell
            .send(zmq_msg)
            .await
            .map_err(|e| format!("Shell send: {}", e))
    }

    pub async fn send_control(&mut self, msg: &JupyterMessage) -> Result<(), String> {
        let frames = msg.to_wire_frames(self.connection.key.as_bytes());
        let zmq_msg = frames_to_zmq_message(frames);
        self.control
            .send(zmq_msg)
            .await
            .map_err(|e| format!("Control send: {}", e))
    }

    pub async fn recv_iopub(&mut self) -> Result<JupyterMessage, String> {
        let zmq_msg = self
            .iopub
            .recv()
            .await
            .map_err(|e| format!("IOPub recv: {}", e))?;
        let frames = zmq_message_to_frames(zmq_msg);
        JupyterMessage::from_wire_frames(&frames, self.connection.key.as_bytes())
    }

    pub async fn recv_shell(&mut self) -> Result<JupyterMessage, String> {
        let zmq_msg = self
            .shell
            .recv()
            .await
            .map_err(|e| format!("Shell recv: {}", e))?;
        let frames = zmq_message_to_frames(zmq_msg);
        JupyterMessage::from_wire_frames(&frames, self.connection.key.as_bytes())
    }
}

/// Convert our Vec<Vec<u8>> frames into a ZMQ multipart message.
fn frames_to_zmq_message(frames: Vec<Vec<u8>>) -> zeromq::ZmqMessage {
    let mut msg = zeromq::ZmqMessage::from(frames[0].clone());
    for frame in &frames[1..] {
        msg.push_back(frame.clone().into());
    }
    msg
}

/// Convert a ZMQ multipart message into Vec<Vec<u8>> frames.
fn zmq_message_to_frames(msg: zeromq::ZmqMessage) -> Vec<Vec<u8>> {
    msg.into_vec().iter().map(|f| f.to_vec()).collect()
}
