import os
from pathlib import Path

# Configuration
OUTPUT_FILE = "project_structure.md"
EXCLUDE_DIRS = {
    ".venv", "venv", "env", "node_modules", ".git", "__pycache__", 
    ".idea", ".vscode", "build", "dist", "target", "out"
}
EXCLUDE_FILES = {
    ".DS_Store", "Thumbs.db", "poetry.lock", "package-lock.json", 
    "yarn.lock", "pnpm-lock.yaml"
}
# Only read text files. Skip large binaries, images, and audios.
TEXT_EXTENSIONS = {
    ".py", ".md", ".txt", ".json", ".js", ".ts", ".tsx", ".jsx", 
    ".html", ".css", ".yaml", ".yml", ".ini", ".conf", ".sh", ".bat"
}

def generate_tree(dir_path, prefix=""):
    """Generates a visual text tree of the directory structure."""
    tree_str = ""
    try:
        entries = sorted(list(dir_path.iterdir()), key=lambda x: (x.is_file(), x.name.lower()))
    except PermissionError:
        return ""

    # Filter entries
    entries = [e for e in entries if e.name not in EXCLUDE_DIRS and e.name not in EXCLUDE_FILES]

    for i, entry in enumerate(entries):
        is_last = (i == len(entries) - 1)
        connector = "└── " if is_last else "├── "
        
        tree_str += f"{prefix}{connector}{entry.name}\n"
        
        if entry.is_dir():
            next_prefix = prefix + ("    " if is_last else "│   ")
            tree_str += generate_tree(entry, next_prefix)
            
    return tree_str

def dump_file_contents(dir_path, out_file):
    """Walks the directory and writes valid text file contents to the output."""
    for root, dirs, files in os.walk(dir_path):
        # Modify dirs in-place to skip excluded directories
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        
        for file in sorted(files):
            if file in EXCLUDE_FILES:
                continue
                
            file_path = Path(root) / file
            if file_path.suffix.lower() not in TEXT_EXTENSIONS:
                continue
                
            # Skip the script itself and the output file
            if file == __file__ or file == OUTPUT_FILE:
                continue

            try:
                # Read content safely
                content = file_path.read_text(encoding="utf-8", errors="ignore")
                
                # Get relative path for cleaner headers
                rel_path = file_path.relative_to(dir_path)
                
                # Write to markdown
                out_file.write(f"## File: {rel_path}\n\n")
                out_file.write(f"```{file_path.suffix[1:] or 'text'}\n")
                out_file.write(content)
                out_file.write("\n```\n\n---\n\n")
            except Exception as e:
                out_file.write(f"## File: {file_path.relative_to(dir_path)}\n")
                out_file.write(f"*Error reading file: {e}*\n\n---\n\n")

def main():
    project_dir = Path.cwd()
    print(f"Scanning project directory: {project_dir}")
    
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(f"# Project Structure and Contents\n\n")
        f.write(f"Generated from root: `{project_dir.name}`\n\n")
        
        # 1. Write the directory tree
        f.write("## Directory Tree\n```text\n")
        f.write(f"{project_dir.name}/\n")
        f.write(generate_tree(project_dir))
        f.write("```\n\n---\n\n")
        
        # 2. Write file contents
        f.write("# File Contents\n\n")
        dump_file_contents(project_dir, f)
        
    print(f"Done! Output saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
