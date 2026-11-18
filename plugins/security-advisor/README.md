# security-advisor

Skills make Claude Code more capable, but a skill is also code and instructions from a third party. A malicious skill can hide prompt injection, read secrets or send data to an external server.

The **security-advisor** plugin watches your session and helps you use skills safely:

- It checks the skills you use for prompt injection and hidden instructions.
- It finds data exfiltration patterns, for example requests to unknown servers.
- It identifies unsafe tool use, for example commands that delete or upload files.
- It warns you before a risky skill runs.

security-advisor works in the Claude Code CLI, Claude Code Desktop and the Claude Code VS Code extension. It needs no settings.

# Install

## Full install of marketplace and plugin
1. Install directly from terminal
   ````
   claude plugin install security-advisor --marketplace stilero/mods-marketplace
   ````

## OR Install marketplace and plugin

1. Add the marketplace:

   ```
   /plugin marketplace add stilero/mods-marketplace
   ```

2. Install the plugin:

   ```
   /plugin install security-advisor@mods-marketplace
   ```

3. Restart Claude Code if the plugin does not start immediately.

4. Send a prompt as usual. security-advisor starts to protect your session.

## Uninstall

```
/plugin uninstall security-advisor@ai-security-workshop
```