require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const pool = require("./config/db");

const app = express();
const walletRoutes = require("./routes/wallet");
const adminFinanceRoutes = require("./routes/adminFinance");

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());
app.use("/api/wallet", walletRoutes);
app.use("/api/admin/finance", adminFinanceRoutes);

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ ok: true, db: "up" });
  } catch (err) {
    console.error("Health check DB error:", err);
    return res.status(500).json({ ok: false, db: "down" });
  }
});

app.use("/api/auth", authRoutes);

const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(`Auth server rodando em http://localhost:${port}`);
});