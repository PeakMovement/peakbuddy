# 300×300 Hosted B App Icon

## Goal
Create a 300×300 pixel version of the existing B app icon (appstore/app-icon-B-v3.png) and host it at a stable CDN URL, without modifying the app code.

## Plan
1. **Resize the existing icon**  
   Use Python/PIL to downscale `/mnt/documents/appstore/app-icon-B-v3.png` to exactly 300×300 px, preserving the blue B, dark navy background, and glow. Save the result to `/mnt/documents/appstore/app-icon-B-300x300.png`.

2. **Upload to Lovable CDN**  
   Run `lovable-assets create --file /mnt/documents/appstore/app-icon-B-300x300.png --filename app-icon-B-300x300.png` to upload the PNG to the Lovable CDN and obtain the `.asset.json` pointer.

3. **Return the hosted URL**  
   Read the generated `.asset.json` and provide the `url` value (e.g. `/__l5e/assets-v1/{asset_id}/app-icon-B-300x300.png`), which is publicly accessible via the project's domain.

## Notes
- No app files will be changed.
- The resulting image will live in `/mnt/documents/appstore/` and as a CDN asset pointer.
- If `lovable-assets` is unavailable, I will fall back to generating the image with the agent image tool and saving it to `/mnt/documents/` for direct preview/download.