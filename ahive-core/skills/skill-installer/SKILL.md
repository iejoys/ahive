---
name: skill-installer
description: Install and uninstall skills for ahive-coder/ahive-worker agents. Use when a user asks to install a skill from a URL/path, or uninstall an existing skill. This skill cannot uninstall itself.
metadata:
  short-description: Install and manage skills for agents
---

# Skill Installer

Manage skills for AHIVE-CORE agents (ahive-coder / ahive-worker).

## Capabilities

- **Install**: Install a skill from a local path, URL, or by creating one from a name+content
- **Uninstall**: Remove an existing skill (except this one — skill-installer cannot be uninstalled)
- **List**: Show all installed skills

## Rules

1. **NEVER uninstall `skill-installer`** — this skill is protected and must always remain available
2. Before uninstalling any skill, confirm with the user first
3. After installing or uninstalling, remind the user: "Restart the agent or reload skills to apply changes"

## How to Install a Skill

Use the `exec` tool to run the install script:

### Install from a GitHub URL
```bash
python3 scripts/install-skill.py --url https://github.com/owner/repo/tree/main/skills/skill-name
```

### Install from a local directory
```bash
python3 scripts/install-skill.py --local /path/to/skill-dir
```

### Install by creating from content
If the user provides skill content directly, create the directory and SKILL.md:

1. Create directory: `mkdir -p skills/<skill-id>`
2. Write SKILL.md with frontmatter + content to `skills/<skill-id>/SKILL.md`

Example SKILL.md:
```markdown
---
name: my-skill
description: What this skill does
category: general
---

# My Skill

Instructions for the agent...
```

## How to Uninstall a Skill

Use the `exec` tool:

```bash
rm -rf skills/<skill-id>
```

**Protected skills** (cannot be uninstalled):
- `skill-installer` — this skill itself

## How to List Skills

Use the `exec` tool:

```bash
ls skills/
```

Or read each SKILL.md for details:
```bash
for dir in skills/*/; do echo "=== $(basename $dir) ==="; head -5 "$dir/SKILL.md" 2>/dev/null; echo; done
```

## Communication

When listing skills:
```
Installed skills:
1. skill-installer (protected)
2. skill-name - short description
3. ...

Which skill would you like to install or uninstall?
```

After installing: "Skill installed. Restart the agent or reload skills to apply changes."
After uninstalling: "Skill removed. Restart the agent or reload skills to apply changes."
