import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { apiRouter } from './server/routes/api.js';
import { globalRateLimiter } from './server/middlewares/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Habilita trust proxy para contêineres e proxy do Cloud Run (necessário para express-rate-limit)
  app.set('trust proxy', 1);

  // Suporte a cookies HttpOnly para autenticação e sessões seguras
  app.use(cookieParser());

  // Rate Limiting Global apenas nas rotas /api (não bloqueia carregamento de módulos Vite nem assets)
  app.use('/api', globalRateLimiter);

  // Suporte a payloads de até 50MB para lotes volumosos de etiquetas
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
  });
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Rotas da API Shopee e TikTok Shop
  app.use('/api', apiRouter);

  // Healthcheck endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'shopee-thermal-processor', timestamp: new Date() });
  });

  // 404 Handler explícito para rotas /api (impede que o middleware do Vite retorne index.html para endpoints de API)
  app.all('/api*', (req, res) => {
    res.status(404).json({
      success: false,
      error: `Endpoint de API não encontrado: ${req.method} ${req.originalUrl}`,
    });
  });

  // Error Handler global para rotas /api (garante que erros de upload/multer ou runtime sempre retornem JSON)
  app.use((err: any, req: any, res: any, next: any) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api')) {
      console.error('[API Server Error Handler]:', err);
      const status = err.status || (err.name === 'MulterError' ? 400 : 500);
      return res.status(status).json({
        success: false,
        error: err.message || 'Erro interno no processamento da API.',
      });
    }
    next(err);
  });

  // Integração Vite: Middleware em Dev / Arquivos Estáticos em Produção
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Enviatto rodando em http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Falha crítica ao iniciar o servidor:', err);
  process.exit(1);
});
