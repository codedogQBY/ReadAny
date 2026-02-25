# Scripts

Place automation scripts here that support the skill's functionality.

## Guidelines

- Use `uv run --script` format for Python scripts (zero-config dependencies)
- Make scripts executable: `chmod +x script.py`
- Include a shebang: `#!/usr/bin/env -S uv run --script`
- Document dependencies in the script header

## Example Script

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "requests",
# ]
# ///

import requests

def main():
    # Your script logic here
    pass

if __name__ == '__main__':
    main()
```
