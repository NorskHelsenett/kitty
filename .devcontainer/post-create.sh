curl -fsSL https://bun.com/install | bash && echo 'export PATH=\"$HOME/.bun/bin:$PATH\"' >> ~/.bashrc

echo "alias kitty='bun run --cwd /workspaces/kitty/ dev'" >> ~/.bashrc