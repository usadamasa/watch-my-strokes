{
  description = "Development environment (Bun)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # tsgo・biome・playwright-core は devDependencies の node_modules から使う
        default = pkgs.mkShellNoCC {
          packages = [ pkgs.bun ];
        };
      });
    };
}
