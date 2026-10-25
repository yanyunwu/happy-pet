// Download the art subpackage while the first screen still owns the canvas.
// Engine initialization subsequently reads the same package from WeChat cache.
module.exports = function preloadResources(runtime, onProgress, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else {
        onProgress(1);
        resolve();
      }
    };
    const timer = setTimeout(
      () => finish(new Error('资源分包下载超时，请检查网络后重新打开')),
      timeoutMs || 45000,
    );
    if (!runtime || typeof runtime.loadSubpackage !== 'function') {
      finish(new Error('当前微信版本不支持资源分包加载'));
      return;
    }
    onProgress(0);
    try {
      const task = runtime.loadSubpackage({
        name: 'resources',
        success: () => finish(),
        fail: (error) => finish(new Error((error && error.errMsg) || '资源分包下载失败')),
      });
      if (task && typeof task.onProgressUpdate === 'function')
        task.onProgressUpdate((result) => {
          if (!settled) onProgress(Math.max(0, Math.min(1, (Number(result.progress) || 0) / 100)));
        });
    } catch (error) {
      finish(error);
    }
  });
};
