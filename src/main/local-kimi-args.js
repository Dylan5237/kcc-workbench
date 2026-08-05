const HOST = '127.0.0.1'

export function buildKimiWebArgs(permissionMode, port) {
  const args = []
  if (permissionMode === 'yolo') args.push('--yolo')
  args.push('web', '--host', HOST, '--port', String(port), '--no-open')
  return args
}
