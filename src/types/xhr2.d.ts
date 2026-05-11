// xhr2 ships no types of its own. We only use its default export as a
// constructor in the parry.gg client setup, so a minimal ambient declaration
// is enough to keep tsc happy.
declare module "xhr2" {
  const xhr: typeof XMLHttpRequest;
  export default xhr;
}
