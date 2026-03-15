import fs from 'fs/promises';
import path from 'path';
import db from '../database';

const SNAPSERVER_CONFIG_PATH = '/etc/snapserver.conf';
const SNAPSHOTS_DIR = path.join(__dirname, '../../snapshots');

export interface Snapshot {
    id: number;
    name: string;
    description: string;
    filename: string;
    timestamp: string;
}

export class SnapshotService {
    constructor() {
        this.ensureSnapshotsDir();
    }

    private async ensureSnapshotsDir() {
        try {
            await fs.access(SNAPSHOTS_DIR);
        } catch {
            await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
        }
    }

    async createSnapshot(name: string, description: string = ''): Promise<Snapshot> {
        await this.ensureSnapshotsDir();
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `snapserver-${timestamp}.conf`;
        const destPath = path.join(SNAPSHOTS_DIR, filename);

        // Copy current config to snapshot directory
        try {
            await fs.copyFile(SNAPSERVER_CONFIG_PATH, destPath);
        } catch (error) {
            console.error('Failed to copy config file for snapshot:', error);
            throw new Error('Could not read /etc/snapserver.conf. Make sure it exists and permissions are correct.');
        }

        // Save metadata to DB
        const stmt = db.prepare('INSERT INTO snapshots (name, description, filename) VALUES (?, ?, ?)');
        const result = stmt.run(name, description, filename);
        
        return {
            id: result.lastInsertRowid as number,
            name,
            description,
            filename,
            timestamp: new Date().toISOString()
        };
    }

    async listSnapshots(): Promise<Snapshot[]> {
        const stmt = db.prepare('SELECT * FROM snapshots ORDER BY timestamp DESC');
        return stmt.all() as Snapshot[];
    }

    async restoreSnapshot(id: number): Promise<void> {
        const stmt = db.prepare('SELECT * FROM snapshots WHERE id = ?');
        const snapshot = stmt.get(id) as Snapshot;

        if (!snapshot) {
            throw new Error('Snapshot not found');
        }

        const srcPath = path.join(SNAPSHOTS_DIR, snapshot.filename);
        
        try {
            await fs.access(srcPath);
            await fs.copyFile(srcPath, SNAPSERVER_CONFIG_PATH);
        } catch (error) {
            console.error('Failed to restore snapshot:', error);
            throw new Error('Snapshot file missing or permission denied');
        }
    }

    async deleteSnapshot(id: number): Promise<void> {
        const stmt = db.prepare('SELECT * FROM snapshots WHERE id = ?');
        const snapshot = stmt.get(id) as Snapshot;

        if (snapshot) {
            const filePath = path.join(SNAPSHOTS_DIR, snapshot.filename);
            try {
                await fs.unlink(filePath);
            } catch (err) {
                console.warn(`Could not delete snapshot file ${filePath}:`, err);
            }
            
            const delStmt = db.prepare('DELETE FROM snapshots WHERE id = ?');
            delStmt.run(id);
        }
    }
}

export const snapshotService = new SnapshotService();
