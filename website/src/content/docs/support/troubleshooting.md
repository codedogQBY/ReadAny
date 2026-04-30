---
draft: false
title: Troubleshooting
description: Solutions for common ReadAny issues and problems.
---

## Common Issues

### Application Won't Start

#### Windows
**Problem**: ReadAny doesn't launch or crashes immediately.

**Solutions**:
1. Check if Microsoft Visual C++ Redistributable is installed
2. Run as Administrator once to establish permissions
3. Temporarily disable antivirus to check for conflicts
4. Reinstall the latest version

#### macOS
**Problem**: "ReadAny is damaged" or "cannot verify developer" error.

**Solutions**:
1. Go to **System Settings → Privacy & Security**
2. Scroll down and click **Open Anyway**
3. Or run in Terminal: `xattr -cr /Applications/ReadAny.app`
4. For Gatekeeper issues: `sudo spctl --master-disable` (use cautiously)

#### Linux
**Problem**: AppImage won't run or shows permission errors.

**Solutions**:
1. Make executable: `chmod +x ReadAny.AppImage`
2. Install FUSE: `sudo apt install libfuse2` (Ubuntu/Debian)
3. Check dependencies: `ldd ReadAny.AppImage`
4. Try the .deb package instead

### Books Won't Open

**Problem**: Clicking a book does nothing or shows an error.

**Solutions**:
1. Verify the file isn't corrupted (try opening in another reader)
2. Check file permissions (ReadAny needs read access)
3. Ensure the file format is supported
4. Try re-importing the book
5. Check if the file has DRM protection (ReadAny doesn't support DRM)

### PDF Rendering Issues

**Problem**: PDFs display incorrectly or missing content.

**Solutions**:
1. Remember that PDF is fixed-layout; some formatting loss is expected
2. Try extracting text-only version if available
3. Use EPUB format when possible for better reading experience
4. Report specific problematic PDFs for improvement

### AI Chat Not Working

**Problem**: AI responses fail or timeout.

**Solutions**:
1. Verify API key is correctly entered in Settings → AI
2. Check internet connection (not needed for Ollama)
3. Test API key with provider's dashboard
4. Try switching to a different model or provider
5. Check API quota/credits remaining
6. For Ollama: ensure service is running (`ollama serve`)

### Semantic Search Issues

**Problem**: Semantic search returns poor results or doesn't work.

**Solutions**:
1. Ensure book has been vectorized (check for vectorization status)
2. Wait for vectorization to complete (large books take time)
3. Try simpler queries initially
4. Verify sufficient system RAM for embedding models
5. Restart ReadAny to clear any caching issues

### Sync Problems

**Problem**: WebDAV sync fails or shows errors.

**Solutions**:
1. Test connection in Settings → Sync
2. Verify WebDAV URL format (include trailing slash if required)
3. Check username/password (use app-specific passwords if available)
4. Ensure WebDAV server has write permissions
5. Verify sufficient storage space on WebDAV server
6. Check firewall/network settings blocking WebDAV

### Performance Issues

**Problem**: ReadAny runs slowly or uses excessive resources.

**Solutions**:
1. Close other applications to free RAM
2. Reduce library size by removing unused books
3. Disable AI features if not needed
4. Lower font rendering quality in Settings
5. Restart ReadAny periodically to clear memory
6. Update to latest version for performance improvements

### TTS Not Working

**Problem**: Text-to-speech doesn't play or sounds incorrect.

**Solutions**:
1. Check system audio output device
2. Verify TTS voices are installed on your system
3. Adjust TTS speed settings (too fast may cause issues)
4. Try different voice options in Settings → TTS
5. On Linux: ensure speech-dispatcher is installed

## Advanced Troubleshooting

### Log Files

ReadAny generates log files for debugging:

**Location**:
- **Windows:** `%APPDATA%\ReadAny\logs`
- **macOS:** `~/Library/Application Support/ReadAny/logs`
- **Linux:** `~/.config/ReadAny/logs`

Include relevant log excerpts when reporting issues.

*Note: Currently, logs must be accessed manually from the file system. An in-app log viewer is planned for a future release.*

### Safe Mode

*Note: Safe mode startup (holding Shift to launch) is not yet implemented. This feature is planned for a future release to help diagnose plugin/extension conflicts.*

### Reset Settings

To reset all settings to defaults:
1. Close ReadAny completely
2. Rename/delete the settings file in data directory
3. Restart ReadAny (new default settings created)

**Warning**: This will erase all customizations but keep books and annotations.

### Database Corruption

*Note: In-app database repair tools are not yet implemented. If you experience database issues:*
1. Backup your data directory first
2. Contact support with error details
3. As last resort: recreate library by re-importing books

## Getting Help

### Before Reporting Issues

1. **Check this troubleshooting guide** first
2. **Search existing issues** on GitHub
3. **Update to latest version** to see if fixed
4. **Gather information**: OS version, ReadAny version, steps to reproduce

### Reporting Bugs

When reporting issues on [GitHub Issues](https://github.com/codedogQBY/ReadAny/issues):

**Include**:
- ReadAny version (Settings → About)
- Operating system and version
- Detailed steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Relevant log file excerpts

**Example Report**:
```
Version: ReadAny 1.2.3
OS: Windows 11 22H2
Issue: PDF books crash when opening
Steps: 1. Import PDF file 2. Click to open 3. App crashes
Expected: Book opens normally
Logs: [attach relevant log excerpt]
```

### Feature Requests

For new features or improvements:
1. Check if already requested in GitHub Issues
2. Provide clear use case and benefits
3. Suggest implementation approach if possible
4. Be open to discussion and alternatives

## Community Support

- **GitHub Discussions**: Ask questions and share tips
- **Discord/Telegram**: Real-time community help (if available)
- **Wiki**: Community-maintained guides and tutorials

Remember to be respectful and helpful in community spaces.
