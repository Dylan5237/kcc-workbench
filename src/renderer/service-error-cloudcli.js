const params = new URLSearchParams(window.location.search)
const detail = params.get('detail')?.trim()

if (detail) {
  document.querySelector('#error-summary').textContent = detail
}

const nodeFailurePattern = /node(?:\.exe)?[^\n]*(?:not found|not recognized|enoent)|node_module_version|module version|abi|process\.versions\.modules/i
if (detail && nodeFailurePattern.test(detail)) {
  document.querySelector('#node-hint').hidden = false
}
