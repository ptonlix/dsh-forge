/** renderer 只通过固定 IPC 事件报告启动健康状态，不暴露 Node 集成能力。 */
import { ipcRenderer } from 'electron';
declare const window: {
  addEventListener(event: string, listener: () => void): void;
  location: { href: string };
};

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('dsh-forge:renderer-boot', Object.freeze({ status: 'healthy', location: window.location.href }));
});
