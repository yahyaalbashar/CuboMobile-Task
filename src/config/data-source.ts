import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

// Detect if running from compiled dist/ or raw ts-node.
// __dirname in dist = <root>/dist/src/config (3 levels up to root)
// __dirname in src  = <root>/src/config       (2 levels up to root)
const isCompiled = __dirname.includes('dist');
const root = isCompiled
  ? path.resolve(__dirname, '..', '..', '..')
  : path.resolve(__dirname, '..', '..');

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'calling_db',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  entities: isCompiled
    ? [path.join(root, 'dist', 'src', '**', '*.entity.js')]
    : [path.join(root, 'src', '**', '*.entity.ts')],
  migrations: isCompiled
    ? [path.join(root, 'dist', 'migrations', '*.js')]
    : [path.join(root, 'migrations', '*.ts')],
});
