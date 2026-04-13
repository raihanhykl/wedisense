import { app } from './app.js';

const PORT = Number(process.env['PORT']) || 4000;

app.listen(PORT, () => {
  console.log(`[API] Server running on http://localhost:${PORT}`);
  console.log(`[API] Health check: http://localhost:${PORT}/api/health`);
});
