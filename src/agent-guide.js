'use strict';

// The instruction sheet an agent receives when it connects to TownMouse.
//
// It describes the tools that exist and the permissions of the specific token
// that is asking. It never grants a capability: the caller already holds one,
// and the same endpoint is served to any holder of a pane token. Every claim
// here is checked against the routes in src/workspace-panes.js and
// scripts/panes — the guide is documentation, not an authorization layer.

const TOOLS = [
  {
    name: 'state',
    cli: 'panes state',
    purpose: 'Read the workspace: tabs, panes, limits, and each pane\'s program status, agent-reported status, and recent command jobs.',
    needs: 'nothing',
    returns: 'Host name, tabs with panes, active tab/pane, limits.'
  },
  {
    name: 'tab.create',
    cli: 'panes tab create --title TEXT [--activate]',
    purpose: 'Create a background workspace tab. It is not activated unless you ask, so the owner\'s view does not move.',
    needs: 'optional title; optional --activate',
    returns: 'The new tab.'
  },
  {
    name: 'tab.close',
    cli: 'panes tab close <tab-id>',
    purpose: 'Close a tab and every pane in it.',
    needs: 'tab id'
  },
  {
    name: 'pane.create',
    cli: 'panes pane create --tab <tab-id> --kind terminal|browser [--url URL] [--cwd PATH] [--title TEXT]',
    purpose: 'Add a terminal or browser pane to a tab. A tab holds at most four panes; a fifth is refused with an explanation.',
    needs: 'tab id, kind; optional url/cwd/title'
  },
  {
    name: 'pane.exec',
    cli: 'panes pane exec <pane-id> -- <command> [--wait-ms N]',
    purpose: 'Run one non-interactive command in the pane\'s working directory as a tracked job. Returns a job id, exit code, stdout and stderr. Use this when you need to know whether a command finished.',
    needs: 'pane id, command',
    returns: 'Job id, status (running|completed|failed), exitCode, stdout, stderr, truncation flags.'
  },
  {
    name: 'pane.job',
    cli: 'panes pane job <pane-id> <job-id>',
    purpose: 'Re-read a tracked job: still running, finished, its exit code, and its output so far.',
    needs: 'pane id and job id'
  },
  {
    name: 'pane.run',
    cli: 'panes pane run <pane-id> <command...>',
    purpose: 'Type a line into the interactive terminal and return recent output. This does not prove the command finished; use pane.exec for that.',
    needs: 'pane id, command text'
  },
  {
    name: 'pane.input',
    cli: 'panes pane input <pane-id> <text...>',
    purpose: 'Send raw text to the interactive terminal without a trailing newline.',
    needs: 'pane id, text'
  },
  {
    name: 'pane.keys',
    cli: 'panes pane keys <pane-id> <key...>',
    purpose: 'Press terminal keys, including modifiers: enter, esc, tab, ctrl+c, alt+x, up/down/left/right.',
    needs: 'pane id, one or more key names'
  },
  {
    name: 'pane.read',
    cli: 'panes pane read <pane-id> [--lines N] [--raw]',
    purpose: 'Read terminal output. Default is clean screen text; --raw returns the original escape sequences.',
    needs: 'pane id; optional line count'
  },
  {
    name: 'pane.wait',
    cli: 'panes pane wait <pane-id> [--match TEXT | --regex PATTERN | --idle MS | --state STATE] [--timeout MS]',
    purpose: 'Wait for a specific terminal condition, bounded by a timeout. Returns matched:true/false and why it stopped.',
    needs: 'pane id and at least one of match/regex/idle/state'
  },
  {
    name: 'pane.status',
    cli: 'panes pane status <pane-id> --state working|blocked|idle|done|unknown [--message TEXT]',
    purpose: 'Report your own status for a terminal pane. This is the agent-reported status, separate from whether the program is running.',
    needs: 'pane id, state'
  },
  {
    name: 'browser.observe',
    cli: 'panes pane browser observe <pane-id> [--elements] [--max N]',
    purpose: 'Take a fresh screenshot with an observation label, and optionally a catalog of the controls on the page.',
    needs: 'browser pane id',
    returns: 'Observation id, capture time, viewport size, scroll offset, address, title, and (with --elements) controls with refs.'
  },
  {
    name: 'browser.elements',
    cli: 'panes pane browser elements <pane-id> [--max N]',
    purpose: 'Catalog controls by identity: role, name, value, state, box, and a ref you can act on. Works inside nested frames and open shadow roots.',
    needs: 'browser pane id'
  },
  {
    name: 'browser.click',
    cli: 'panes pane browser click <pane-id> (--ref e12 | --x N --y N [--observation N])',
    purpose: 'Click a control by ref (preferred) or by coordinate from a named observation. A coordinate from a stale observation is refused.',
    needs: 'browser pane id and ref, or x/y with the observation they came from'
  },
  {
    name: 'browser.type',
    cli: 'panes pane browser type <pane-id> <text...> [--ref e12] [--replace]',
    purpose: 'Type text, optionally into a specific control. --replace selects the existing content first instead of appending.',
    needs: 'browser pane id, text; optional ref'
  },
  {
    name: 'browser.key',
    cli: 'panes pane browser key <pane-id> <key...>',
    purpose: 'Press browser keys, including combinations such as Alt+M, Control+Shift+Tab.',
    needs: 'browser pane id, key names'
  },
  {
    name: 'browser.hover',
    cli: 'panes pane browser hover <pane-id> (--ref e12 | --x N --y N)',
    purpose: 'Move the pointer over a target without clicking.',
    needs: 'browser pane id and ref or coordinates'
  },
  {
    name: 'browser.drag',
    cli: 'panes pane browser drag <pane-id> --from-ref e12 --to-ref e15',
    purpose: 'Drag from one target to another inside the agent browser.',
    needs: 'browser pane id and two targets'
  },
  {
    name: 'browser.scroll',
    cli: 'panes pane browser scroll <pane-id> [--ref e12 | --selector CSS] [--dy N] [--dx N]',
    purpose: 'Scroll a named area. Without a target it scrolls the page; with one it scrolls that element\'s own scroll box.',
    needs: 'browser pane id; optional target and deltas'
  },
  {
    name: 'browser.select',
    cli: 'panes pane browser select <pane-id> --ref e12 --value V',
    purpose: 'Set the value of a select or input by ref.',
    needs: 'browser pane id, ref, value'
  },
  {
    name: 'browser.navigate',
    cli: 'panes pane browser navigate <pane-id> <url>',
    purpose: 'Open an http(s) address. The reply carries the new address and the new title.',
    needs: 'browser pane id, URL'
  },
  {
    name: 'browser.wait',
    cli: 'panes pane browser wait <pane-id> [--url URL | --text TEXT | --selector CSS | --value TEXT --ref e12] [--timeout MS]',
    purpose: 'Wait until the page reaches a condition, bounded by a timeout. Prefer this over sleeping.',
    needs: 'browser pane id, one condition, optional timeout'
  },
  {
    name: 'browser.text',
    cli: 'panes pane browser text <pane-id>',
    purpose: 'Read the page text, with an explicit flag when it was cut short.',
    needs: 'browser pane id'
  },
  {
    name: 'browser.dialog',
    cli: 'panes pane dialog <pane-id> --accept|--dismiss [--text VALUE]',
    purpose: 'Answer a page dialog that is waiting.',
    needs: 'browser pane id and an action'
  },
  {
    name: 'browser.sizing',
    cli: 'panes pane browser sizing <pane-id> fit|fixed [--width N] [--height N]',
    purpose: 'Choose whether the page resizes with the human viewer (fit) or keeps a fixed size (fixed), so the owner\'s window never rearranges it.',
    needs: 'browser pane id and mode'
  },
  {
    name: 'attach',
    cli: 'panes attach <file> [--pane <pane-id>] [--type MIME]',
    purpose: 'Upload a file to the workspace and optionally insert its path into a terminal pane.',
    needs: 'file path'
  }
];

const CAPABILITIES = [
  {
    id: 'workspace',
    granted: true,
    summary: 'Create, read, and close workspace tabs and panes through the scoped pane token you already hold.'
  },
  {
    id: 'browser.control',
    granted: true,
    summary: 'Drive browser panes you create or that the owner has shared with control permission.'
  },
  {
    id: 'browser.sharing',
    granted: false,
    summary: 'Change a browser\'s sharing permission or reveal its access token. Only the owner page can do this; an agent token is refused.'
  },
  {
    id: 'owner.page',
    granted: false,
    summary: 'Read or bootstrap the owner workspace token. An Authorization header is refused at the bootstrap routes.'
  },
  {
    id: 'workspace.limits',
    granted: true,
    summary: 'Limits are enforced and unchanged: at most four panes per tab, 24 tabs, 24 terminal panes, 32 browser tabs.'
  }
];

function buildGuide(options = {}) {
  const cli = options.cli || { available: false };
  const lines = [];
  lines.push('TownMouse agent guide');
  lines.push('');
  lines.push('You are connected to a TownMouse workspace through a scoped agent token.');
  lines.push('This sheet tells you what you may do. It does not add permissions you were not granted.');
  lines.push('');
  lines.push('## Two ways to work');
  lines.push('');
  if (cli.available) {
    lines.push(`The native command-line tool is available in your terminal panes: ${cli.path || 'panes'}`);
    lines.push('It already holds the workspace token, so never copy or paste a token yourself.');
    lines.push('You can also call the HTTP API directly with the TOWNMOUSE_TOKEN environment variable.');
  } else {
    lines.push('The native command-line tool is not on PATH here. Call the HTTP API with TOWNMOUSE_API and TOWNMOUSE_TOKEN from the environment.');
  }
  lines.push('');
  lines.push('## Ground rules');
  lines.push('- Never activate or switch the owner\'s visible tab unless they asked you to.');
  lines.push('- Prefer element refs from a fresh observation over coordinates.');
  lines.push('- A coordinate is only valid for the observation it came from; a stale one is refused.');
  lines.push('- Use a bounded wait instead of guessing that a page is ready after a pause.');
  lines.push('- "job completed" is the only proof a command finished. A typed line returning output is not proof.');
  lines.push('- Tokens go in the X-Townmouse-Token header, never in a URL, page text, or screenshot.');
  lines.push('');
  lines.push('## Tools');
  lines.push('');
  for (const tool of TOOLS) {
    lines.push(`### ${tool.name}`);
    lines.push(tool.purpose);
    lines.push(`CLI: ${tool.cli}`);
    lines.push(`Needs: ${tool.needs}`);
    if (tool.returns) lines.push(`Returns: ${tool.returns}`);
    lines.push('');
  }
  lines.push('## What this connection may do');
  lines.push('');
  for (const capability of CAPABILITIES) {
    lines.push(`- ${capability.granted ? 'ALLOWED' : 'NOT ALLOWED'}: ${capability.summary}`);
  }
  lines.push('');
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    cli,
    capabilities: CAPABILITIES,
    tools: TOOLS,
    text: lines.join('\n')
  };
}

module.exports = { buildGuide, TOOLS, CAPABILITIES };
