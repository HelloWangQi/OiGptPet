function assertTrustedSender(event, windows, fromWebContents) {
  const owner = fromWebContents(event.sender);
  if (!owner || owner.isDestroyed() || !windows.includes(owner) || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Unknown IPC sender');
  }
  return owner;
}
module.exports = { assertTrustedSender };
