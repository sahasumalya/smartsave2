# Running the app with Podman (instead of Docker Desktop)

[Podman](https://podman.io/) is a daemonless, rootless container engine that’s CLI-compatible with Docker. You can use it instead of Docker Desktop on Mac.

## 1. Install Podman on Mac

```bash
brew install podman
```

## 2. Start the Podman machine

Podman on Mac runs a small Linux VM (“machine”). Start it once per session (or after reboot):

```bash
podman machine init
podman machine start
```

Check that it’s running:

```bash
podman info
```

## 3. Run the app with the script

The run script supports Podman via `CONTAINER_CMD`:

```bash
cd /Users/ssaha6/side/smartSave/smartsave2
CONTAINER_CMD=podman ./scripts/docker-run.sh
```

This starts MySQL, runs the schema, builds the app image, and runs the app.  
**App:** http://localhost:3000  
**MySQL:** localhost:3306 (user `smartsave`, password `smartsave`)

To stop: Ctrl+C, then:

```bash
podman rm -f smartsave-mysql
```

## 4. Use Podman by default (optional)

To avoid typing `CONTAINER_CMD=podman` every time:

```bash
export CONTAINER_CMD=podman
./scripts/docker-run.sh
```

Or add to `~/.zshrc`:

```bash
export CONTAINER_CMD=podman
```

## 5. Compose with Podman (optional)

To use `docker-compose.yml` with Podman, install **podman-compose**:

```bash
pip install podman-compose
```

Then from the project root:

```bash
podman-compose up --build
```

Or, if your Podman version supports it:

```bash
podman compose up --build
```

## 6. Podman machine management

| Command | Description |
|--------|-------------|
| `podman machine start` | Start the Podman VM |
| `podman machine stop` | Stop the VM |
| `podman machine list` | Show VM status |
| `podman machine ssh` | SSH into the VM (advanced) |

You need the machine to be **started** before running `podman` (or the script with `CONTAINER_CMD=podman`).

---

## Troubleshooting: MySQL container exits with code 1

If the script fails with "MySQL container exited" or "Could not get MySQL container IP", the MySQL container is crashing on start. Check the logs:

```bash
podman logs smartsave-mysql
```

**Common causes and fixes:**

1. **Stale or corrupt volume** – The script now removes the MySQL volume on cleanup (`rm -f -v`). Remove the container and run again:
   ```bash
   podman rm -f -v smartsave-mysql
   CONTAINER_CMD=podman ./scripts/docker-run.sh
   ```

2. **Podman machine resources** – Give the Podman VM more memory (then recreate the machine):
   ```bash
   podman machine stop
   podman machine set --memory 4096
   podman machine start
   ```

3. **Use MariaDB instead of MySQL** – If MySQL 8 keeps failing on Podman, you can switch the script to use the `mariadb` image (compatible with MySQL clients). Or run the app with **Docker Desktop** instead of Podman for this project.
