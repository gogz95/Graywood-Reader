# Simpler Placeholder System for Manhuasync

## Replacement Plan for Placeholder Generation

The current implementation has an overly complex SVG-based placeholder system. To implement a simple "missing series" placeholder as requested, replace the `/api/reader/panel-image` endpoint logic with:

### New Simple Logic:
1. When manga parameter contains "missing" or "unavailable" or is "Page Panel":
   - Return a simple HTML page with descriptive message 
   - Clearly indicate the content is missing
   - Show basic reasons why it might be missing
   - Keep it minimal and informative
2. For normal cases, keep existing behavior (but focus on simplicity)

### Minimal Replacement Text:
Replace SVG generation portion with:
```javascript
// Simple text-based placeholder for missing/unavailable series
if (manga.includes('Page Panel') || manga.includes('missing') || manga.includes('unavailable')) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Content Unavailable</title></head>
    <body>
      <h1>⚠️ Content Unavailable</h1>
      <p>The chapter pages for "${escapeXml(manga)}" couldn't be loaded.</p>
      <p>This often happens when the series is removed, source is unavailable, or chapter doesn't exist.</p>
    </body>
    </html>
  `);
  return;
}
```

### Benefits:
1. Significantly simpler than current generation
2. No complex SVG rendering 
3. Clear message to user about what's happening
4. Lightweight performance characteristics
5. Meets requirement for "just a missing series page" instead of complex placeholders