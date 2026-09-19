# Harness friction

- The shared instructions reference `$SKILLS_ROOT/_lib/features-yaml.md`, but that file is missing in the active Pi skills install. The supported `_lib/features_yaml.sh describe` command is available and was used instead. Restore the referenced guide or correct the instruction path.
- The `frontend-designer` child (`0f8a3cd4`) stopped without a result file. Its metadata remained `starting` while status reported stopped. The parent completed design direction from the actual TUI code; no designer findings were claimed. The plan-critic child returned normally.
- The user invoked `q/rev`, but the native workflow remained on Execute. `set_workflow_step` was not available, and `set_workflow_activity("fixing-review-findings")` was rejected for that step. The authorized review continued without changing ticket status or claiming workflow completion.
