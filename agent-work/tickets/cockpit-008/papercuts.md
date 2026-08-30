# Papercuts

- `tmux_subagent` `status` and `wait` returned `Unexpected end of JSON input` for active jobs even though launches and result files succeeded. Polling the documented job result path was required to continue. The management actions should surface valid job state or a specific transport error.
