let socket;

export function connect(playerName) {
  socket = new WebSocket("ws://localhost:3000");

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: "ENTRAR_SALA",
      payload: { nomeJogador: playerName }
    }));
  };

  socket.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    handleServerMessage(data);
  };
}

function handleServerMessage(message) {
  console.log("SERVER:", message);
}
