# Contributing

## Or: Small, Focused, And Tested Beats Large And Mysterious

Townmouse is a terminal and agent browser workspace built at Floyd's Labs. It embeds TerminalOne as its terminal engine; the browser workspace, the agent browser, view and control grants, and the workspace interface are Townmouse's own. Contributions are welcome.

The garage has one maintainer, two cats, and a coffee maker that has never passed code review. Keep changes small enough to review before the coffee goes cold.

## Start small

Start with a small issue or a focused pull request. Explain the problem, the behavior after the change, and the relevant check you ran. Small and focused beats large and mysterious.

Use the README's development checks:

```sh
npm test               # engine suite: boundaries, input, smoke, features, voice, responsive
npm run test:workspace # browser workspace journeys (starts its own preview site)
```

## Keep the tree clean

Keep generated runtime state, private paths, credentials, and transcripts out of commits. A clean tree is easier to review, and nobody needs your shell history in a pull request.

## Prove the boundary

Changes to guards or credential handling need a regression case that demonstrates the boundary — one that would fail without the change. A guard without a test is a hope with a comment.

## Review and license

The maintainer reviews contributions on a best-effort basis. Publication of this repository does not change its license terms. Townmouse is AGPL-3.0-only, and contributions land under the same terms.

---

Built at Floyd's Labs. Bella checks the keyboard; Bowser watches the router.
