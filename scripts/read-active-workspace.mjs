// Passed to Playwright's page.evaluate. Open a read transaction behind any
// pending workspace saves so camera/selection assertions see the committed view.
export function readActiveWorkspace() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("oneearth.sessions.v1", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("workspaces");
      const item = tx.objectStore("workspaces").get(history.state.oneearthSession);
      item.onsuccess = () => resolve(item.result);
      item.onerror = () => reject(item.error);
      tx.oncomplete = () => db.close();
    };
  });
}
