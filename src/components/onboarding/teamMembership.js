export function teamIncludesRegisteredUser(teamNames, userName) {
  const user = String(userName || '').trim();
  return Boolean(user) && String(teamNames || '').split(',').map(name => name.trim()).includes(user);
}
