(function (global) {
  function isExpanded({ depth, path, filter, expanded, collapsed }) {
    if (filter) return true;
    if (expanded.has(path)) return true;
    return depth === 0 && !collapsed.has(path);
  }

  function toggle({ depth, path, expanded, collapsed }) {
    if (isExpanded({ depth, path, filter: '', expanded, collapsed })) {
      expanded.delete(path);
      collapsed.add(path);
      return false;
    }
    collapsed.delete(path);
    expanded.add(path);
    return true;
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '--';
    const pad = part => String(part).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function isFileVersionChanged(current, next) {
    if (!current || !next) return false;
    return current.mtime !== next.mtime || current.size !== next.size;
  }

  global.ViewerTreeState = Object.freeze({
    isExpanded,
    toggle,
    formatTimestamp,
    isFileVersionChanged
  });
})(globalThis);
