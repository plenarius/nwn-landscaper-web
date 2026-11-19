# Security

Report a security problem privately, through GitHub: on this repository's **Security** tab, choose **Report a vulnerability**
(a private security advisory). Don't open a public issue for it. Say what an attacker can do, and how to reproduce it.

This page runs in the builder's browser and talks only to the engine that serves it. A problem in the engine (the HTTP server,
the files it reads or writes, signing in on a team server) belongs to [nwn-landscaper](https://github.com/plenarius/nwn-landscaper);
report it there the same way. If you aren't sure which one it is, report it here.

Two rules in this repository exist for security; a way past either is a security problem:

- Text from an area file, the engine's answers or the browser's storage goes into the page as text, never as HTML.
- Every request to the engine carries the `X-Landscaper: 1` header, so the engine can refuse requests from other sites.

[README.md](README.md#development) explains both.
