import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({root:import.meta.dirname,server:{host:'127.0.0.1',port:5183,strictPort:true,fs:{allow:[resolve(import.meta.dirname,'../../../..')]},proxy:{'/trpc':'http://127.0.0.1:4413','/events':'http://127.0.0.1:4413','/health':'http://127.0.0.1:4413'}}});

