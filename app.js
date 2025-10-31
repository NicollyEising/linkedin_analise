const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// Servir arquivos estáticos (HTML, CSS, JS, imagens)
app.use(express.static(__dirname));

// Rota principal (carrega o index.html)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Inicializar o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
