import { defineConfig } from '../../../packages/ui/node_modules/vite/dist/node/index.js';
import { resolve } from 'node:path';
const proxy = () => ({target:'http://127.0.0.1:4414', configure(server:any){server.on('proxyReq',(request:any)=>request.setHeader('origin','http://127.0.0.1:4414'));}});
export default defineConfig({root:resolve(import.meta.dirname,'../../../packages/ui'),server:{host:'127.0.0.1',port:5184,strictPort:true,proxy:{'/trpc':proxy(),'/events':proxy(),'/health':proxy()}}});
