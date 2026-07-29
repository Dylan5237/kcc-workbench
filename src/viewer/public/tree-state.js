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

  global.ViewerTreeState = Object.freeze({ isExpanded, toggle });
})(globalThis);
