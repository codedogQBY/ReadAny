---
draft: false
title: Library Management
description: Organize and manage your e-book library effectively.
---

## Library Overview

Your ReadAny library is the central hub for all your e-books. It provides powerful tools to organize, search, and manage your collection.

## Adding Books

### Drag and Drop
The easiest way to add books is to drag files directly from your file manager into the ReadAny window. Supported formats are automatically detected and imported.

### Import Button
Click the **"+"** button in the toolbar to open a file selection dialog. You can select multiple files at once.

### File Associations
After installation, you can double-click any supported e-book file to open it directly in ReadAny. The book will be automatically added to your library if not already present.

## Organizing Your Library

### Sorting Options
Sort your library by:
- **Title** - Alphabetical order by book title
- **Author** - Group books by author name
- **Date Added** - Recently imported books first
- **Last Read** - Books you've read recently appear first
- **Progress** - Sort by reading completion percentage

### Tags and Collections
Organize books using tags:
1. Right-click on any book
2. Select "Add Tag" or choose from existing tags
3. Create custom tags like "Fiction", "Technical", "To Read", etc.
4. Filter your library by clicking on tags in the sidebar

### Search Functionality
Use the search bar at the top of the library to find books by:
- Title (partial matches work)
- Author name
- Tags
- ISBN (if available in metadata)

## Book Information

Each book displays:
- Cover image (extracted from the file)
- Title and author
- Reading progress indicator
- Last accessed date
- File format and size

### Viewing Book Details
Right-click on any book and select "Properties" to see detailed information including:
- Full metadata (publisher, publication date, language, etc.)
- File location on your device
- Reading statistics (time spent, pages read)
- Annotation count

## Managing Books

### Removing Books
To remove a book from your library:
1. Right-click on the book
2. Select "Remove from Library"
3. Choose whether to also delete the file from your device

**Note:** Removing from library only removes the entry; the actual file remains on your device unless you choose to delete it.

### Bulk Operations
Select multiple books using Ctrl/Cmd+Click or Shift+Click to perform bulk operations:
- Add/remove tags
- Delete multiple books
- Export annotations from multiple books

## Reading Progress Tracking

ReadAny automatically tracks:
- Current reading position
- Total time spent reading each book
- Pages/chapters completed
- Last access date

This information is displayed in the library view and can be used for sorting.

## Backup and Restore

### Library Backup
Your library data (metadata, reading positions, annotations) is stored locally. To backup:
1. Locate the ReadAny data directory:
   - **Windows:** `%APPDATA%\ReadAny`
   - **macOS:** `~/Library/Application Support/ReadAny`
   - **Linux:** `~/.config/ReadAny`
2. Copy the entire directory to your backup location

### Library Restore
To restore from backup:
1. Close ReadAny completely
2. Replace the current data directory with your backup
3. Restart ReadAny

## Performance Tips

For large libraries (1000+ books):
- Use tags and filters to narrow down visible books
- Regularly remove books you no longer need
- Consider organizing books into subdirectories outside ReadAny and importing as needed
- The search function becomes more valuable as your library grows
