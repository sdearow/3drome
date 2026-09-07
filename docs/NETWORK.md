# When the photorealistic context will not load

The application works offline in geometry-only mode. The photorealistic context is the
one part that needs the network, and on a managed corporate network it is the part most
likely to be blocked.

The panel in the top-left corner names which case you are in. Start there rather than
guessing — the four causes below look identical from the outside (an empty sky) and need
completely different responses.

## "No Cesium ion token yet"

Expected on a fresh checkout. Nothing is broken.

1. Sign up at <https://cesium.com/ion/> — free, no credit card. Google Photorealistic 3D
   Tiles are included with the account, so you do **not** need a Google Cloud billing
   account.
2. Open **Access Tokens** in the ion dashboard and copy the default token. It is long and
   starts with `eyJ`.
3. Open `app/src/config.js`, find `ionToken: ""` in the `view` block, and paste it
   between the quotes:

   ```js
   ionToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
   ```

4. Save and reload the page. Do a hard reload — `Ctrl+F5` — if the panel does not change.

## "Cesium ion rejected the token"

The token arrived but ion refused it. Almost always the copy: tokens are long and easy to
truncate. Copy it again with the dashboard's copy button rather than selecting by hand,
and check you have not pasted the token *name* instead of the token itself.

If the token is definitely right, check in the ion dashboard that it has not been revoked
and that it still carries the default asset access.

## "Could not reach Cesium ion at all"

The request never left the network. This is a proxy or firewall, not a problem with the
code or your account, and no amount of re-pasting the token will fix it.

To use the photorealistic context you need outbound HTTPS to:

| Host | What for |
|---|---|
| `api.cesium.com` | Token validation and asset metadata |
| `assets.ion.cesium.com` | Cesium ion asset delivery |
| `tile.googleapis.com` | The photorealistic tiles themselves |

That is the list to send to whoever manages the proxy. It is a read-only allowlist
request for a mapping service; nothing is uploaded and no data leaves the machine.

Two things worth mentioning when you ask, because they are the questions that usually
come back: the tiles are streamed and never cached to disk, and the service is Google
Maps Platform accessed through Cesium, not a general-purpose web tunnel.

## "The account is fine, but the tiles could not be fetched"

`api.cesium.com` is reachable but the tile hosts are not — a partial allowlist. Ask for
`tile.googleapis.com` and `assets.ion.cesium.com` to be added.

This can also appear if TLS interception rewrites certificates in a way the browser
rejects for those hosts specifically. If your IT team confirms interception is active,
the tile hosts usually need to be on the bypass list rather than the inspect list.

## If none of it can be unblocked

The application is still useful without the context, and this is worth saying plainly
rather than treating it as a degraded mode:

- The design geometry, the before/after comparison, the day/night toggle, the chainage
  readout and both exports all work with no network at all.
- What you lose is the surrounding city — the recognisability, not the proposal.
- The intervention zone was always meant to stand on its own measured surface rather
  than on the photogrammetric mesh, so nothing dimensional depends on the context being
  there.

If the context stays blocked on the work machine, the sensible fallback is to add
building footprints from DBGT around the corridor. That gives enough surrounding built
form to orient a viewer, it comes from data you already hold, and it needs no external
service at all.
