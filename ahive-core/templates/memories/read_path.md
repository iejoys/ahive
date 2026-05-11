# Memory Access Guide

Your agent has access to a persistent memory system stored at:

**Memory Root**: `{{ base_path }}`

## How to Access Memories

1. **Quick Reference**: Read `memory_summary.md` for user preferences and recent topics
2. **Deep Dive**: Search `MEMORY.md` for detailed task-specific knowledge
3. **Historical Context**: Browse `rollout_summaries/` for past session details

## Memory Summary

{{ memory_summary }}

## Usage Guidelines

- Memory files are read-only during normal operation
- Update memories through the designated memory update tools
- Respect cwd boundaries when applying stored knowledge
- Verify information freshness before relying on older memories