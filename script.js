"use strict";

/* ============================================================
   PV TRACKER CALCULATOR - script.js
   Calculates support post spacing, pipe segment lengths,
   and connector positions for photovoltaic trackers.
   ============================================================ */

// ============================================================
// SECTION 1 - Configuration & Constants
// ============================================================

const CONFIG = {
    moduleWidth: 1303,       // Module width in mm
    dilation: 29,            // Gap between modules in mm
    modulesLeft: 24,         // Number of modules on left side
    modulesRight: 24,        // Number of modules on right side
    motorGap: 630,           // Wider gap at motor center (between innermost modules)
    pipeGapMotor: 140,       // Pipe gap at motor (70mm each side from center)
    standardPipeLength: 12000, // Standard pipe length in mm
    pipeGap: 10,             // Gap between consecutive pipes (connector sits here)
    connectorLength: 300,    // Connector length centered on pipe gap
    supportWidth: 250        // Support post width in mm
};

// Color palette for pipe length types
const PIPE_COLORS = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6'  // purple
];

// Spacing type definitions (multiplier of raster, rounded to nearest 100mm)
const SPACING_TYPES = {
    A: { multiplier: 5, label: 'A (duzy)' },
    B: { multiplier: 4, label: 'B (sredni)' },
    C: { multiplier: 2, label: 'C (maly/krawedz)' }
};

// ============================================================
// SECTION 2 - Module Position Calculator
// ============================================================

/**
 * Calculate module positions for one side of the tracker.
 * Position 0 = motor center. Positive = right, Negative = left.
 * @param {number} numModules - Number of modules on this side
 * @param {number} moduleWidth - Width of each module in mm
 * @param {number} dilation - Normal gap between modules in mm
 * @param {number} motorGap - Wider gap at motor center in mm
 * @param {string} side - 'left' or 'right'
 * @returns {Array} Array of module position objects
 */
function calculateModulePositions(numModules, moduleWidth, dilation, motorGap, side) {
    const modules = [];
    const direction = (side === 'right') ? 1 : -1;

    // First module starts at motorGap/2 from center
    // The inner edge of first module is at motorGap/2 from center
    const firstModuleInnerEdge = motorGap / 2;

    for (let i = 0; i < numModules; i++) {
        let innerEdge;
        if (i === 0) {
            innerEdge = firstModuleInnerEdge;
        } else {
            // Each subsequent module is separated by dilation from the previous
            innerEdge = firstModuleInnerEdge + i * (moduleWidth + dilation);
        }
        const outerEdge = innerEdge + moduleWidth;
        const center = innerEdge + moduleWidth / 2;

        modules.push({
            index: i,
            side: side,
            centerX: center * direction,
            leftEdge: (side === 'right') ? innerEdge : -outerEdge,
            rightEdge: (side === 'right') ? outerEdge : -innerEdge,
            innerEdge: innerEdge * direction,
            outerEdge: outerEdge * direction,
            absCenter: center,      // Absolute distance from center (always positive)
            absInnerEdge: innerEdge,
            absOuterEdge: outerEdge
        });
    }

    return modules;
}

// ============================================================
// SECTION 3 - Support Post Layout Algorithm
// ============================================================

/**
 * Round a value to the nearest multiple of 100.
 */
function roundTo100(value) {
    return Math.round(value / 100) * 100;
}

/**
 * Maximum allowed support post spacing in mm.
 */
const MAX_SPACING = 6600;

/**
 * Calculate spacing value for a given type and raster.
 * Clamped to MAX_SPACING (6600mm) regardless of raster calculation.
 */
function getSpacing(type, raster) {
    return Math.min(roundTo100(SPACING_TYPES[type].multiplier * raster), MAX_SPACING);
}

/**
 * Find the nearest module center to a given position.
 * @param {number} absPosition - Absolute position from tracker center
 * @param {Array} modules - Array of module position objects for one side
 * @returns {object|null} Nearest module or null
 */
function findNearestModule(absPosition, modules) {
    let nearest = null;
    let minDist = Infinity;
    for (const mod of modules) {
        const dist = Math.abs(absPosition - mod.absCenter);
        if (dist < minDist) {
            minDist = dist;
            nearest = mod;
        }
    }
    return { module: nearest, distance: minDist };
}

/**
 * Calculate support post layout for one side.
 * Motor support is always at position 0.
 * Posts are placed working outward from motor.
 * @param {Array} modules - Module positions for this side (from calculateModulePositions)
 * @param {number} raster - Module raster (width + dilation)
 * @returns {Array} Array of support post objects
 */
function calculateSupportPosts(modules, raster) {
    if (modules.length === 0) return [];

    const numModules = modules.length;
    const lastModuleCenter = modules[numModules - 1].absCenter;
    const tolerance = raster / 3;

    // Calculate spacing values
    const spacingA = getSpacing('A', raster);
    const spacingB = getSpacing('B', raster);
    const spacingC = getSpacing('C', raster);

    // Determine the pattern based on number of modules
    // Goal: cover from motor to last module center using A, B, C spacings
    // Pattern strategy:
    //   - For large counts (>=20): B + A*n + B (standard pattern)
    //   - For very large counts (>=28): C + B + A*n + B + C or similar
    //   - For smaller counts: B + A*n + C or C + A*n + C

    const posts = [];
    let currentPos = 0; // Motor support position (absolute distance)

    // Try different patterns and pick the best one
    const patterns = generatePatterns(numModules, raster, lastModuleCenter, spacingA, spacingB, spacingC);

    // Find the best pattern (prefer more A-type spacings, then closest to last module center)
    let bestPattern = null;
    let bestScore = -Infinity;

    for (const pattern of patterns) {
        let pos = 0;
        for (const spacing of pattern) {
            pos += spacing;
        }
        const error = Math.abs(pos - lastModuleCenter);
        // Count A-type spacings (more A = better, since A is the largest allowed)
        const countA = pattern.filter(s => s === spacingA).length;
        // Score: prioritize more A spacings, then penalize distance from target
        const score = countA * 10000 - error;
        if (score > bestScore) {
            bestScore = score;
            bestPattern = pattern;
        }
    }
    const bestError = bestPattern ? Math.abs(bestPattern.reduce((s, v) => s + v, 0) - lastModuleCenter) : Infinity;

    // If no good pattern found, use a greedy approach
    if (!bestPattern || bestError > raster) {
        bestPattern = greedySupportPattern(numModules, raster, lastModuleCenter, spacingA, spacingB, spacingC, tolerance, modules);
    }

    // Build posts from the best pattern
    if (bestPattern) {
        currentPos = 0;
        for (let i = 0; i < bestPattern.length; i++) {
            currentPos += bestPattern[i];
            const { module: nearestMod, distance } = findNearestModule(currentPos, modules);
            const spacingType = bestPattern[i] === spacingA ? 'A' :
                               bestPattern[i] === spacingB ? 'B' : 'C';
            posts.push({
                position: currentPos,
                absPosition: currentPos,
                spacingFromPrevious: bestPattern[i],
                spacingType: spacingType,
                nearestModuleIndex: nearestMod ? nearestMod.index : -1,
                distanceToModule: distance
            });
        }
    }

    return posts;
}

/**
 * Generate candidate spacing patterns for support posts.
 */
function generatePatterns(numModules, raster, targetDistance, spacingA, spacingB, spacingC) {
    const patterns = [];

    // Pattern 1: B + A*n + B
    for (let n = 0; n <= 10; n++) {
        const total = 2 * spacingB + n * spacingA;
        if (Math.abs(total - targetDistance) < raster) {
            const pattern = [spacingB];
            for (let i = 0; i < n; i++) pattern.push(spacingA);
            pattern.push(spacingB);
            patterns.push(pattern);
        }
    }

    // Pattern 2: C + A*n + C
    for (let n = 0; n <= 10; n++) {
        const total = 2 * spacingC + n * spacingA;
        if (Math.abs(total - targetDistance) < raster) {
            const pattern = [spacingC];
            for (let i = 0; i < n; i++) pattern.push(spacingA);
            pattern.push(spacingC);
            patterns.push(pattern);
        }
    }

    // Pattern 3: B + A*n + C
    for (let n = 0; n <= 10; n++) {
        const total = spacingB + n * spacingA + spacingC;
        if (Math.abs(total - targetDistance) < raster) {
            const pattern = [spacingB];
            for (let i = 0; i < n; i++) pattern.push(spacingA);
            pattern.push(spacingC);
            patterns.push(pattern);
        }
    }

    // Pattern 4: C + B + A*n + B + C
    for (let n = 0; n <= 10; n++) {
        const total = 2 * spacingC + 2 * spacingB + n * spacingA;
        if (Math.abs(total - targetDistance) < raster) {
            const pattern = [spacingC, spacingB];
            for (let i = 0; i < n; i++) pattern.push(spacingA);
            pattern.push(spacingB);
            pattern.push(spacingC);
            patterns.push(pattern);
        }
    }

    // Pattern 5: A*n + B
    for (let n = 1; n <= 10; n++) {
        const total = n * spacingA + spacingB;
        if (Math.abs(total - targetDistance) < raster) {
            const pattern = [];
            for (let i = 0; i < n; i++) pattern.push(spacingA);
            pattern.push(spacingB);
            patterns.push(pattern);
        }
    }

    // Pattern 6: B + A*n
    for (let n = 1; n <= 10; n++) {
        const total = spacingB + n * spacingA;
        if (Math.abs(total - targetDistance) < raster) {
            const pattern = [spacingB];
            for (let i = 0; i < n; i++) pattern.push(spacingA);
            patterns.push(pattern);
        }
    }

    // Pattern 7: n*B + m*A + C (flexible B-heavy patterns ending with A and C)
    for (let nB = 1; nB <= 10; nB++) {
        for (let mA = 0; mA <= 5; mA++) {
            const total = nB * spacingB + mA * spacingA + spacingC;
            if (Math.abs(total - targetDistance) < raster) {
                const pattern = [];
                for (let i = 0; i < nB; i++) pattern.push(spacingB);
                for (let i = 0; i < mA; i++) pattern.push(spacingA);
                pattern.push(spacingC);
                patterns.push(pattern);
            }
        }
    }

    // Pattern 8: n*B + m*A (all B with trailing A spacings)
    for (let nB = 1; nB <= 10; nB++) {
        for (let mA = 1; mA <= 5; mA++) {
            const total = nB * spacingB + mA * spacingA;
            if (Math.abs(total - targetDistance) < raster) {
                const pattern = [];
                for (let i = 0; i < nB; i++) pattern.push(spacingB);
                for (let i = 0; i < mA; i++) pattern.push(spacingA);
                patterns.push(pattern);
            }
        }
    }

    // Pattern 9: C + n*B + m*A + C (edge pattern with B-heavy core)
    for (let nB = 1; nB <= 8; nB++) {
        for (let mA = 0; mA <= 5; mA++) {
            const total = 2 * spacingC + nB * spacingB + mA * spacingA;
            if (Math.abs(total - targetDistance) < raster) {
                const pattern = [spacingC];
                for (let i = 0; i < nB; i++) pattern.push(spacingB);
                for (let i = 0; i < mA; i++) pattern.push(spacingA);
                pattern.push(spacingC);
                patterns.push(pattern);
            }
        }
    }

    // Pattern 10: m*A + n*B + C (A-leading patterns)
    for (let mA = 1; mA <= 5; mA++) {
        for (let nB = 1; nB <= 8; nB++) {
            const total = mA * spacingA + nB * spacingB + spacingC;
            if (Math.abs(total - targetDistance) < raster) {
                const pattern = [];
                for (let i = 0; i < mA; i++) pattern.push(spacingA);
                for (let i = 0; i < nB; i++) pattern.push(spacingB);
                pattern.push(spacingC);
                patterns.push(pattern);
            }
        }
    }

    return patterns;
}

/**
 * Greedy approach with backtracking: work outward placing posts at nearest module centers.
 * Uses depth-limited search to avoid dead-ends.
 */
function greedySupportPattern(numModules, raster, targetDistance, spacingA, spacingB, spacingC, tolerance, modules) {
    const spacings = [spacingA, spacingB, spacingC];

    // Recursive search with backtracking (depth-limited)
    function search(currentPos, pattern, depth) {
        // Check if we reached the target
        if (currentPos >= targetDistance - tolerance && currentPos <= targetDistance + tolerance) {
            // Verify the last post lands near a module center
            const { distance } = findNearestModule(currentPos, modules);
            if (distance <= tolerance) {
                return [...pattern];
            }
        }

        // If we overshot or hit depth limit, fail this branch
        if (currentPos > targetDistance + tolerance || depth > 12) {
            return null;
        }

        // Try each spacing, preferring those that land closer to module centers
        const candidates = [];
        for (const spacing of spacings) {
            const nextPos = currentPos + spacing;
            if (nextPos > targetDistance + tolerance) continue;

            const { distance } = findNearestModule(nextPos, modules);
            if (distance <= tolerance) {
                candidates.push({ spacing, nextPos, distance });
            }
        }

        // Sort by distance to module center (prefer closer to center)
        candidates.sort((a, b) => a.distance - b.distance);

        for (const candidate of candidates) {
            const result = search(candidate.nextPos, [...pattern, candidate.spacing], depth + 1);
            if (result) return result;
        }

        return null; // No valid continuation from this state
    }

    const result = search(0, [], 0);
    if (result) return result;

    // Fallback: simple greedy without backtracking (original behavior but with better scoring)
    const pattern = [];
    let currentPos = 0;

    while (currentPos < targetDistance - tolerance) {
        let bestSpacing = null;
        let bestScore = Infinity;

        for (const spacing of spacings) {
            const nextPos = currentPos + spacing;
            if (nextPos > targetDistance + tolerance) continue;

            const { distance } = findNearestModule(nextPos, modules);
            if (distance > tolerance) continue;

            // Score: prefer landing closer to module center, with small penalty for remaining distance
            const remainingDistance = targetDistance - nextPos;
            const score = distance * 2 + (remainingDistance < 0 ? 10000 : 0);

            // When scores are similar (within 50mm), prefer spacingA (largest allowed)
            if (score < bestScore - 50 || (Math.abs(score - bestScore) <= 50 && spacing === spacingA)) {
                bestScore = score;
                bestSpacing = spacing;
            }
        }

        if (bestSpacing === null) {
            // No valid move - use smallest spacing to avoid overshoot
            bestSpacing = spacingC;
        }

        pattern.push(bestSpacing);
        currentPos += bestSpacing;

        // Safety: prevent infinite loop
        if (pattern.length > 20) break;
    }

    return pattern;
}

// ============================================================
// SECTION 4 - Pipe Segment Layout
// ============================================================

/**
 * Check if a connector at a given position collides with any support post.
 * Connector zone: connectorLength centered on position.
 * Support zone: supportWidth centered on post position.
 * @param {number} connectorCenter - Center position of connector (abs from tracker center)
 * @param {Array} supportPosts - Array of support post objects
 * @param {number} connectorLength - Length of connector
 * @param {number} supportWidth - Width of support post
 * @returns {boolean} True if collision detected
 */
function checkConnectorCollision(connectorCenter, supportPosts, connectorLength, supportWidth) {
    const connHalfLen = connectorLength / 2;
    const suppHalfWidth = supportWidth / 2;

    for (const post of supportPosts) {
        const postPos = post.absPosition || Math.abs(post.position);
        // Check overlap between connector zone and support zone
        const connStart = connectorCenter - connHalfLen;
        const connEnd = connectorCenter + connHalfLen;
        const postStart = postPos - suppHalfWidth;
        const postEnd = postPos + suppHalfWidth;

        if (connStart < postEnd && connEnd > postStart) {
            return true; // Collision!
        }
    }
    // Also check motor support at position 0
    const connStart = connectorCenter - connHalfLen;
    const connEnd = connectorCenter + connHalfLen;
    if (connStart < suppHalfWidth && connEnd > -suppHalfWidth) {
        return true;
    }

    return false;
}

/**
 * Calculate pipe segments for one side of the tracker.
 * @param {Array} supportPosts - Support posts for this side
 * @param {Array} modules - Module positions for this side
 * @param {number} standardPipeLength - Standard pipe length in mm
 * @param {number} pipeGap - Gap between pipes in mm
 * @param {number} connectorLength - Connector length in mm
 * @param {number} supportWidth - Support post width in mm
 * @param {number} pipeGapMotor - Pipe gap at motor in mm
 * @param {number} raster - Module raster (width + dilation)
 * @returns {object} { pipes: [...], connectors: [...] }
 */
function calculatePipeSegments(supportPosts, modules, standardPipeLength, pipeGap, connectorLength, supportWidth, pipeGapMotor, raster) {
    const pipes = [];
    const connectors = [];

    if (modules.length === 0) return { pipes, connectors };

    const lastModule = modules[modules.length - 1];
    const trackEnd = lastModule.absOuterEdge;
    const minOverhang = 100;
    const maxOverhang = 300;

    // Pipe starts at pipeGapMotor/2 from center
    let pipeStart = pipeGapMotor / 2;
    let pipeIndex = 0;

    while (pipeStart < trackEnd + minOverhang) {
        // Determine max pipe end
        let pipeEnd = pipeStart + standardPipeLength;

        // Check if this pipe reaches beyond the track end with valid overhang
        if (pipeEnd >= trackEnd + minOverhang) {
            // This is the last pipe - adjust to proper overhang
            const desiredEnd = trackEnd + 200; // Target 200mm overhang (middle of 100-300)
            pipeEnd = desiredEnd;

            // Ensure we don't exceed standard length
            if (pipeEnd - pipeStart > standardPipeLength) {
                pipeEnd = pipeStart + standardPipeLength;
            }

            // Round pipe length to nearest 100mm
            let roundedLength = roundTo100(pipeEnd - pipeStart);
            let roundedEnd = pipeStart + roundedLength;
            let overhang = roundedEnd - trackEnd;

            // Verify overhang is still within 100-300mm after rounding
            if (overhang < minOverhang || overhang > maxOverhang) {
                // Try the other rounding direction
                const altLength = overhang < minOverhang
                    ? roundedLength + 100  // round up
                    : roundedLength - 100; // round down
                const altEnd = pipeStart + altLength;
                const altOverhang = altEnd - trackEnd;
                if (altOverhang >= minOverhang && altOverhang <= maxOverhang && altLength > 0) {
                    roundedLength = altLength;
                    roundedEnd = altEnd;
                }
            }

            pipeEnd = roundedEnd;

            pipes.push({
                index: pipeIndex,
                startX: pipeStart,
                endX: pipeEnd,
                length: roundedLength
            });
            break;
        }

        // Not the last pipe - need a connector after it
        // The connector center will be at pipeEnd + pipeGap/2
        let connectorCenter = pipeEnd + pipeGap / 2;

        // Check for collision with support posts
        let collisionUnresolved = false;
        if (checkConnectorCollision(connectorCenter, supportPosts, connectorLength, supportWidth)) {
            // Try adjusting: shorten pipe by raster increments
            let adjusted = false;

            for (let adj = 1; adj <= 3; adj++) {
                // Try shortening
                const shorterEnd = pipeEnd - adj * raster;
                const shorterConnCenter = shorterEnd + pipeGap / 2;
                if (shorterEnd > pipeStart + raster && !checkConnectorCollision(shorterConnCenter, supportPosts, connectorLength, supportWidth)) {
                    pipeEnd = shorterEnd;
                    connectorCenter = shorterConnCenter;
                    adjusted = true;
                    break;
                }

                // Try lengthening (if still within standard)
                const longerEnd = pipeEnd + adj * raster;
                if (longerEnd - pipeStart <= standardPipeLength) {
                    const longerConnCenter = longerEnd + pipeGap / 2;
                    if (!checkConnectorCollision(longerConnCenter, supportPosts, connectorLength, supportWidth)) {
                        pipeEnd = longerEnd;
                        connectorCenter = longerConnCenter;
                        adjusted = true;
                        break;
                    }
                }
            }

            // If still colliding, try half-raster adjustments
            if (!adjusted) {
                for (let adj = 1; adj <= 6; adj++) {
                    const halfRaster = raster / 2;
                    const shorterEnd = pipeEnd - adj * halfRaster;
                    const shorterConnCenter = shorterEnd + pipeGap / 2;
                    if (shorterEnd > pipeStart + raster && !checkConnectorCollision(shorterConnCenter, supportPosts, connectorLength, supportWidth)) {
                        pipeEnd = shorterEnd;
                        connectorCenter = shorterConnCenter;
                        adjusted = true;
                        break;
                    }
                }
            }

            // Track unresolved collision for warning
            if (!adjusted) {
                collisionUnresolved = true;
            }
        }

        // Round pipe length to nearest 100mm
        pipeEnd = pipeStart + roundTo100(pipeEnd - pipeStart);

        // Recalculate connector center after rounding
        connectorCenter = pipeEnd + pipeGap / 2;

        pipes.push({
            index: pipeIndex,
            startX: pipeStart,
            endX: pipeEnd,
            length: roundTo100(pipeEnd - pipeStart),
            collisionUnresolved: collisionUnresolved
        });

        // Record connector
        connectors.push({
            index: connectors.length,
            position: connectorCenter,
            betweenPipes: [pipeIndex, pipeIndex + 1],
            collisionUnresolved: collisionUnresolved
        });

        // Next pipe starts after the gap
        pipeStart = pipeEnd + pipeGap;
        pipeIndex++;

        // Safety: prevent infinite loop
        if (pipeIndex > 20) break;
    }

    return { pipes, connectors };
}

// ============================================================
// SECTION 5 - Pipe Length Optimization
// ============================================================

/**
 * Optimize pipe lengths across all tracker variants.
 * Group similar lengths together to minimize unique pipe types.
 * @param {Array} allPipeSegments - Array of pipe segment arrays from all variants/sides
 * @returns {Array} Optimized pipe catalog: [{length, count, usage}]
 */
function optimizePipeLengths(allPipeSegments) {
    // Collect all pipe lengths
    const allLengths = [];
    for (const segments of allPipeSegments) {
        for (const pipe of segments) {
            allLengths.push(pipe.length);
        }
    }

    if (allLengths.length === 0) return [];

    // Sort lengths
    allLengths.sort((a, b) => a - b);

    // Cluster pipe lengths - since all pipes are now multiples of 100mm,
    // use exact match (0 tolerance) for clustering
    const clusters = [];
    let currentCluster = [allLengths[0]];

    for (let i = 1; i < allLengths.length; i++) {
        if (allLengths[i] === currentCluster[0]) {
            currentCluster.push(allLengths[i]);
        } else {
            clusters.push([...currentCluster]);
            currentCluster = [allLengths[i]];
        }
    }
    clusters.push(currentCluster);

    // For each cluster, show actual lengths and count
    const catalog = [];
    for (const cluster of clusters) {
        // Use the most common value, or the longest if all unique
        const lengthCounts = {};
        for (const len of cluster) {
            lengthCounts[len] = (lengthCounts[len] || 0) + 1;
        }
        // Sort by count descending, then by length descending
        const sorted = Object.entries(lengthCounts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
        // Show all actual lengths in the cluster
        const uniqueInCluster = [...new Set(cluster)].sort((a, b) => a - b);
        const lengthsStr = uniqueInCluster.join(', ');
        catalog.push({
            length: parseInt(sorted[0][0]), // Representative: most common length
            actualLengths: uniqueInCluster,
            count: cluster.length,
            usage: `${cluster.length}x segmentow (${lengthsStr}mm)`
        });
    }

    return catalog;
}

// ============================================================
// SECTION 6 - Validation Engine
// ============================================================

/**
 * Validate the complete layout and return warnings/errors.
 * @param {Array} modules - All module positions
 * @param {Array} supportPosts - All support posts
 * @param {object} pipeLayout - Pipe layout result
 * @param {number} raster - Module raster
 * @param {number} connectorLength - Connector length
 * @param {number} supportWidth - Support width
 * @returns {Array} Array of {type: 'error'|'warning'|'info', message}
 */
function validateLayout(modules, supportPosts, pipeLayout, raster, connectorLength, supportWidth) {
    const messages = [];

    if (modules.length === 0) {
        messages.push({ type: 'error', message: 'Brak modulow do obliczenia.' });
        return messages;
    }

    const tolerance = raster / 3;

    // Check support posts land near module centers
    for (const post of supportPosts) {
        if (post.distanceToModule > tolerance) {
            messages.push({
                type: 'warning',
                message: `Slupek na pozycji ${Math.round(post.absPosition)}mm jest ${Math.round(post.distanceToModule)}mm od najblizszego srodka modulu (tolerancja: ${Math.round(tolerance)}mm).`
            });
        }
    }

    // Check connector-support collisions
    if (pipeLayout && pipeLayout.connectors) {
        for (const conn of pipeLayout.connectors) {
            if (conn.collisionUnresolved) {
                messages.push({
                    type: 'error',
                    message: `Zlaczka na pozycji ${Math.round(conn.position)}mm - nie udalo sie uniknac kolizji ze slupkiem! Wszystkie proby dostosowania wyczerpane.`
                });
            } else if (checkConnectorCollision(conn.position, supportPosts, connectorLength, supportWidth)) {
                messages.push({
                    type: 'error',
                    message: `Zlaczka na pozycji ${Math.round(conn.position)}mm koliduje ze slupkiem!`
                });
            }
        }
    }

    // Check last pipe overhang
    if (pipeLayout && pipeLayout.pipes && pipeLayout.pipes.length > 0) {
        const lastPipe = pipeLayout.pipes[pipeLayout.pipes.length - 1];
        const lastModule = modules[modules.length - 1];
        const overhang = lastPipe.endX - lastModule.absOuterEdge;

        if (overhang < 100) {
            messages.push({
                type: 'warning',
                message: `Ostatnia rura wystaje tylko ${Math.round(overhang)}mm za ostatni modul (wymagane: 100-300mm).`
            });
        } else if (overhang > 300) {
            messages.push({
                type: 'warning',
                message: `Ostatnia rura wystaje ${Math.round(overhang)}mm za ostatni modul (zalecane: 100-300mm).`
            });
        }

        // Check no pipe exceeds standard length
        for (const pipe of pipeLayout.pipes) {
            if (pipe.length > CONFIG.standardPipeLength + 10) {
                messages.push({
                    type: 'error',
                    message: `Rura #${pipe.index + 1} (${pipe.length}mm) przekracza standardowa dlugosc ${CONFIG.standardPipeLength}mm!`
                });
            }
        }
    }

    // Check support spacing types are valid
    const validSpacings = [getSpacing('A', raster), getSpacing('B', raster), getSpacing('C', raster)];
    for (const post of supportPosts) {
        if (!validSpacings.includes(post.spacingFromPrevious)) {
            messages.push({
                type: 'warning',
                message: `Slupek na pozycji ${Math.round(post.absPosition)}mm ma niestandardowy rozstaw ${post.spacingFromPrevious}mm.`
            });
        }
    }

    // Info messages
    if (messages.length === 0) {
        messages.push({ type: 'info', message: 'Wszystkie ograniczenia spelnione. Uklad prawidlowy.' });
    }

    return messages;
}

// ============================================================
// SECTION 7 - Canvas Visualization
// ============================================================

/** Canvas state for zoom/pan */
const canvasState = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
    pixelsPerMm: 0.05 // Initial scale: 1 pixel = 20mm
};

/**
 * Draw the full tracker visualization on the canvas.
 * @param {object} results - Calculation results from runCalculation()
 */
function drawVisualization(results) {
    const canvas = document.getElementById('trackerCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Set canvas size to container
    const container = canvas.parentElement;
    canvas.width = container.clientWidth * 2; // HiDPI
    canvas.height = container.clientHeight * 2;
    ctx.scale(2, 2); // HiDPI scaling

    const W = container.clientWidth;
    const H = container.clientHeight;

    // Clear
    ctx.clearRect(0, 0, W, H);

    if (!results) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Kliknij "Oblicz" aby wygenerowac wizualizacje', W / 2, H / 2);
        return;
    }

    // Apply transform (zoom + pan)
    ctx.save();
    ctx.translate(canvasState.offsetX + W / 2, canvasState.offsetY + H / 2);
    ctx.scale(canvasState.scale, canvasState.scale);

    const ppm = canvasState.pixelsPerMm; // pixels per mm at base scale

    // Draw dimensions
    const allModules = [...(results.modulesLeft || []), ...(results.modulesRight || [])];

    // Y positions for different elements (in pixels)
    const moduleY = -30;
    const moduleHeight = 40;
    const supportY = moduleY + moduleHeight + 5;
    const supportHeight = 15;
    const pipeY = supportY + supportHeight + 10;
    const pipeHeight = 10;
    const connectorY = pipeY - 3;
    const connectorHeight = pipeHeight + 6;

    // Draw modules
    ctx.fillStyle = '#bfdbfe'; // light blue
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 0.5;

    for (const mod of allModules) {
        const x = mod.leftEdge * ppm;
        const w = (mod.rightEdge - mod.leftEdge) * ppm;
        ctx.fillRect(x, moduleY, w, moduleHeight);
        ctx.strokeRect(x, moduleY, w, moduleHeight);
    }

    // Draw motor center marker
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(-3, moduleY - 15, 6, moduleHeight + supportHeight + 40);
    ctx.fillStyle = '#1e293b';
    ctx.font = `${Math.max(8, 10 / canvasState.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('MOTOR', 0, moduleY - 20);

    // Draw support posts (motor support at 0 + others)
    ctx.fillStyle = '#374151'; // dark gray
    // Motor support
    const motorSuppW = results.supportWidth * ppm;
    ctx.fillRect(-motorSuppW / 2, supportY, motorSuppW, supportHeight);

    // Left side supports
    if (results.supportPostsLeft) {
        for (const post of results.supportPostsLeft) {
            const x = -post.absPosition * ppm - motorSuppW / 2;
            ctx.fillRect(x, supportY, motorSuppW, supportHeight);
        }
    }

    // Right side supports
    if (results.supportPostsRight) {
        for (const post of results.supportPostsRight) {
            const x = post.absPosition * ppm - motorSuppW / 2;
            ctx.fillRect(x, supportY, motorSuppW, supportHeight);
        }
    }

    // Draw pipes with color coding
    const pipeLengthTypes = results.pipeLengthTypes || [];

    function getPipeColor(length) {
        for (let i = 0; i < pipeLengthTypes.length; i++) {
            if (length === pipeLengthTypes[i]) {
                return PIPE_COLORS[i % PIPE_COLORS.length];
            }
        }
        return PIPE_COLORS[0];
    }

    // Right side pipes
    if (results.pipeLayoutRight && results.pipeLayoutRight.pipes) {
        for (const pipe of results.pipeLayoutRight.pipes) {
            ctx.fillStyle = getPipeColor(pipe.length);
            const x = pipe.startX * ppm;
            const w = (pipe.endX - pipe.startX) * ppm;
            ctx.fillRect(x, pipeY, w, pipeHeight);
        }
    }

    // Left side pipes
    if (results.pipeLayoutLeft && results.pipeLayoutLeft.pipes) {
        for (const pipe of results.pipeLayoutLeft.pipes) {
            ctx.fillStyle = getPipeColor(pipe.length);
            const x = -pipe.endX * ppm;
            const w = (pipe.endX - pipe.startX) * ppm;
            ctx.fillRect(x, pipeY, w, pipeHeight);
        }
    }

    // Draw connectors
    ctx.fillStyle = '#f97316'; // orange
    if (results.pipeLayoutRight && results.pipeLayoutRight.connectors) {
        for (const conn of results.pipeLayoutRight.connectors) {
            const connW = results.connectorLength * ppm;
            const x = conn.position * ppm - connW / 2;
            ctx.fillRect(x, connectorY, connW, connectorHeight);
        }
    }
    if (results.pipeLayoutLeft && results.pipeLayoutLeft.connectors) {
        for (const conn of results.pipeLayoutLeft.connectors) {
            const connW = results.connectorLength * ppm;
            const x = -conn.position * ppm - connW / 2;
            ctx.fillRect(x, connectorY, connW, connectorHeight);
        }
    }

    // Draw dimension annotations for supports
    ctx.fillStyle = '#6b7280';
    ctx.font = `${Math.max(6, 8 / canvasState.scale)}px sans-serif`;
    ctx.textAlign = 'center';

    if (results.supportPostsRight) {
        let prevPos = 0;
        for (const post of results.supportPostsRight) {
            const midX = ((prevPos + post.absPosition) / 2) * ppm;
            ctx.fillText(`${post.spacingFromPrevious}`, midX, supportY + supportHeight + 12);
            prevPos = post.absPosition;
        }
    }

    if (results.supportPostsLeft) {
        let prevPos = 0;
        for (const post of results.supportPostsLeft) {
            const midX = -((prevPos + post.absPosition) / 2) * ppm;
            ctx.fillText(`${post.spacingFromPrevious}`, midX, supportY + supportHeight + 12);
            prevPos = post.absPosition;
        }
    }

    // Scale indicator
    ctx.restore();

    // Draw scale bar in bottom-left
    ctx.fillStyle = '#1e293b';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    const scaleBarMm = 5000; // 5m reference
    const scaleBarPx = scaleBarMm * ppm * canvasState.scale;
    const barX = 20;
    const barY = H - 20;
    ctx.fillRect(barX, barY, scaleBarPx, 2);
    ctx.fillRect(barX, barY - 4, 1, 8);
    ctx.fillRect(barX + scaleBarPx, barY - 4, 1, 8);
    ctx.fillText(`${scaleBarMm / 1000}m`, barX + scaleBarPx / 2 - 10, barY - 8);

    // Legend
    ctx.font = '9px sans-serif';
    let legendY = 15;
    ctx.fillStyle = '#bfdbfe';
    ctx.fillRect(W - 130, legendY, 12, 8);
    ctx.fillStyle = '#1e293b';
    ctx.fillText('Moduly', W - 112, legendY + 8);
    legendY += 14;
    ctx.fillStyle = '#374151';
    ctx.fillRect(W - 130, legendY, 12, 8);
    ctx.fillStyle = '#1e293b';
    ctx.fillText('Slupki', W - 112, legendY + 8);
    legendY += 14;
    ctx.fillStyle = '#f97316';
    ctx.fillRect(W - 130, legendY, 12, 8);
    ctx.fillStyle = '#1e293b';
    ctx.fillText('Zlaczki', W - 112, legendY + 8);
    legendY += 14;
    for (let i = 0; i < Math.min(pipeLengthTypes.length, 5); i++) {
        ctx.fillStyle = PIPE_COLORS[i];
        ctx.fillRect(W - 130, legendY, 12, 8);
        ctx.fillStyle = '#1e293b';
        ctx.fillText(`Rura ${pipeLengthTypes[i]}mm`, W - 112, legendY + 8);
        legendY += 14;
    }
}

/**
 * Initialize canvas event listeners for zoom and pan.
 */
function initCanvasControls() {
    const canvas = document.getElementById('trackerCanvas');
    if (!canvas) return;

    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        canvasState.scale *= zoomFactor;
        canvasState.scale = Math.max(0.1, Math.min(10, canvasState.scale));
        drawVisualization(lastResults);
    });

    // Mouse drag pan
    canvas.addEventListener('mousedown', (e) => {
        canvasState.isDragging = true;
        canvasState.lastMouseX = e.clientX;
        canvasState.lastMouseY = e.clientY;
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!canvasState.isDragging) return;
        const dx = e.clientX - canvasState.lastMouseX;
        const dy = e.clientY - canvasState.lastMouseY;
        canvasState.offsetX += dx;
        canvasState.offsetY += dy;
        canvasState.lastMouseX = e.clientX;
        canvasState.lastMouseY = e.clientY;
        drawVisualization(lastResults);
    });

    canvas.addEventListener('mouseup', () => {
        canvasState.isDragging = false;
    });

    canvas.addEventListener('mouseleave', () => {
        canvasState.isDragging = false;
    });

    // Reset view button
    const resetBtn = document.getElementById('resetViewBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            canvasState.scale = 1;
            canvasState.offsetX = 0;
            canvasState.offsetY = 0;
            drawVisualization(lastResults);
        });
    }
}

// ============================================================
// SECTION 8 - UI Controller
// ============================================================

/** Store last calculation results for redraw */
let lastResults = null;

/** Store tracker variants for pipe optimization */
let variants = [];

/**
 * Read all input values from the form.
 * @returns {object} Parameter values
 */
function readInputs() {
    function parseVal(id, defaultVal) {
        const val = parseInt(document.getElementById(id).value);
        return isNaN(val) ? defaultVal : val;
    }
    return {
        moduleWidth: parseVal('moduleWidth', CONFIG.moduleWidth),
        dilation: parseVal('dilation', CONFIG.dilation),
        modulesLeft: parseVal('modulesLeft', CONFIG.modulesLeft),
        modulesRight: parseVal('modulesRight', CONFIG.modulesRight),
        motorGap: parseVal('motorGap', CONFIG.motorGap),
        pipeGapMotor: parseVal('pipeGapMotor', CONFIG.pipeGapMotor),
        standardPipeLength: parseVal('standardPipeLength', CONFIG.standardPipeLength),
        pipeGap: parseVal('pipeGap', CONFIG.pipeGap),
        connectorLength: parseVal('connectorLength', CONFIG.connectorLength),
        supportWidth: parseVal('supportWidth', CONFIG.supportWidth)
    };
}

/**
 * Run the full calculation pipeline.
 * @param {object} params - Input parameters
 * @returns {object} Complete calculation results
 */
function runCalculation(params) {
    const raster = params.moduleWidth + params.dilation;

    // Calculate module positions for both sides
    const modulesRight = calculateModulePositions(
        params.modulesRight, params.moduleWidth, params.dilation, params.motorGap, 'right'
    );
    const modulesLeft = calculateModulePositions(
        params.modulesLeft, params.moduleWidth, params.dilation, params.motorGap, 'left'
    );

    // Calculate support post layout for both sides
    const supportPostsRight = calculateSupportPosts(modulesRight, raster);
    const supportPostsLeft = calculateSupportPosts(modulesLeft, raster);

    // Calculate pipe segments for both sides
    const pipeLayoutRight = calculatePipeSegments(
        supportPostsRight, modulesRight,
        params.standardPipeLength, params.pipeGap,
        params.connectorLength, params.supportWidth,
        params.pipeGapMotor, raster
    );
    const pipeLayoutLeft = calculatePipeSegments(
        supportPostsLeft, modulesLeft,
        params.standardPipeLength, params.pipeGap,
        params.connectorLength, params.supportWidth,
        params.pipeGapMotor, raster
    );

    // Collect all unique pipe lengths for color coding
    const allPipes = [...pipeLayoutRight.pipes, ...pipeLayoutLeft.pipes];
    const uniqueLengths = [...new Set(allPipes.map(p => p.length))].sort((a, b) => a - b);
    // Since all pipes are now multiples of 100mm, use exact match for type grouping
    const pipeLengthTypes = [...uniqueLengths];

    // Validate
    const warningsRight = validateLayout(modulesRight, supportPostsRight, pipeLayoutRight, raster, params.connectorLength, params.supportWidth);
    const warningsLeft = validateLayout(modulesLeft, supportPostsLeft, pipeLayoutLeft, raster, params.connectorLength, params.supportWidth);

    // Combine
    const allWarnings = [
        ...warningsRight.map(w => ({ ...w, message: `[Prawa] ${w.message}` })),
        ...warningsLeft.map(w => ({ ...w, message: `[Lewa] ${w.message}` }))
    ];

    return {
        params,
        raster,
        modulesRight,
        modulesLeft,
        supportPostsRight,
        supportPostsLeft,
        pipeLayoutRight,
        pipeLayoutLeft,
        pipeLengthTypes,
        warnings: allWarnings,
        supportWidth: params.supportWidth,
        connectorLength: params.connectorLength
    };
}

/**
 * Main calculation trigger - reads inputs, runs calc, updates UI.
 */
function calculate() {
    const params = readInputs();
    lastResults = runCalculation(params);

    // Update visualization
    drawVisualization(lastResults);

    // Update BOM tables
    generateBOM(lastResults);

    // Show warnings
    displayWarnings(lastResults.warnings);

    // Run optimization across all variants
    runOptimization(lastResults);
}

/**
 * Display validation warnings.
 */
function displayWarnings(warnings) {
    const section = document.getElementById('warningsSection');
    const list = document.getElementById('warningsList');
    if (!section || !list) return;

    list.innerHTML = '';
    if (warnings.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    for (const w of warnings) {
        const div = document.createElement('div');
        div.className = `warning-item ${w.type}`;
        div.textContent = w.message;
        list.appendChild(div);
    }
}

/**
 * Add a tracker variant for pipe optimization.
 */
function addVariant() {
    const params = readInputs();
    const raster = params.moduleWidth + params.dilation;
    variants.push({
        id: variants.length + 1,
        modulesLeft: params.modulesLeft,
        modulesRight: params.modulesRight,
        moduleWidth: params.moduleWidth,
        dilation: params.dilation,
        raster: raster
    });
    renderVariantList();
    runOptimization(lastResults);
}

/**
 * Remove a tracker variant.
 */
function removeVariant(index) {
    variants.splice(index, 1);
    // Re-number
    variants.forEach((v, i) => v.id = i + 1);
    renderVariantList();
    runOptimization(lastResults);
}

/**
 * Render the variant list in the sidebar.
 */
function renderVariantList() {
    const container = document.getElementById('variantList');
    if (!container) return;
    container.innerHTML = '';

    for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const div = document.createElement('div');
        div.className = 'variant-item';
        div.innerHTML = `
            <span class="variant-info">W${v.id}: ${v.modulesLeft}L + ${v.modulesRight}R (${v.moduleWidth}+${v.dilation}mm)</span>
            <button class="btn-remove" data-index="${i}">&times;</button>
        `;
        container.appendChild(div);
    }

    // Attach remove handlers
    container.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            removeVariant(parseInt(e.target.dataset.index));
        });
    });
}

/**
 * Run pipe optimization across current results + all variants.
 */
function runOptimization(currentResults) {
    const allPipeSegments = [];

    // Current calculation pipes
    if (currentResults) {
        if (currentResults.pipeLayoutRight) allPipeSegments.push(currentResults.pipeLayoutRight.pipes);
        if (currentResults.pipeLayoutLeft) allPipeSegments.push(currentResults.pipeLayoutLeft.pipes);
    }

    // Variant pipes
    for (const v of variants) {
        const params = {
            ...readInputs(),
            modulesLeft: v.modulesLeft,
            modulesRight: v.modulesRight,
            moduleWidth: v.moduleWidth,
            dilation: v.dilation
        };
        const result = runCalculation(params);
        if (result.pipeLayoutRight) allPipeSegments.push(result.pipeLayoutRight.pipes);
        if (result.pipeLayoutLeft) allPipeSegments.push(result.pipeLayoutLeft.pipes);
    }

    const optimized = optimizePipeLengths(allPipeSegments);
    renderOptimizationTable(optimized);
}

/**
 * Debounce utility.
 */
function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Initialize UI event listeners.
 */
function initUI() {
    // Calculate button
    const calcBtn = document.getElementById('calculateBtn');
    if (calcBtn) {
        calcBtn.addEventListener('click', calculate);
    }

    // Add variant button
    const addVarBtn = document.getElementById('addVariantBtn');
    if (addVarBtn) {
        addVarBtn.addEventListener('click', addVariant);
    }

    // Auto-calculate on input change (debounced)
    const debouncedCalc = debounce(calculate, 500);
    const inputs = document.querySelectorAll('.input-panel input[type="number"]');
    inputs.forEach(input => {
        input.addEventListener('input', debouncedCalc);
    });

    // Initialize canvas controls
    initCanvasControls();

    // Handle window resize
    window.addEventListener('resize', debounce(() => {
        if (lastResults) drawVisualization(lastResults);
    }, 200));

    // Initial calculation
    calculate();
}

// ============================================================
// SECTION 9 - BOM Generator
// ============================================================

/**
 * Generate and render all BOM tables.
 * @param {object} results - Calculation results
 */
function generateBOM(results) {
    if (!results) return;
    renderSupportTable(results);
    renderPipeTable(results);
    renderConnectorTable(results);
    renderSummaryTable(results);
}

/**
 * Render support post schedule table.
 */
function renderSupportTable(results) {
    const tbody = document.querySelector('#supportTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let rowNum = 1;

    // Motor support
    const motorRow = document.createElement('tr');
    motorRow.innerHTML = `<td>${rowNum++}</td><td>Srodek</td><td>0</td><td>-</td><td>Motor</td><td>-</td>`;
    tbody.appendChild(motorRow);

    // Right side
    if (results.supportPostsRight) {
        for (const post of results.supportPostsRight) {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${rowNum++}</td><td>Prawa</td><td>${Math.round(post.absPosition)}</td><td>${post.spacingFromPrevious}</td><td>${post.spacingType}</td><td>#${post.nearestModuleIndex + 1}</td>`;
            tbody.appendChild(row);
        }
    }

    // Left side
    if (results.supportPostsLeft) {
        for (const post of results.supportPostsLeft) {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${rowNum++}</td><td>Lewa</td><td>${Math.round(post.absPosition)}</td><td>${post.spacingFromPrevious}</td><td>${post.spacingType}</td><td>#${post.nearestModuleIndex + 1}</td>`;
            tbody.appendChild(row);
        }
    }
}

/**
 * Render pipe segments table.
 */
function renderPipeTable(results) {
    const tbody = document.querySelector('#pipeTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let rowNum = 1;
    const pipeLengthTypes = results.pipeLengthTypes || [];

    function getTypeClass(length) {
        for (let i = 0; i < pipeLengthTypes.length; i++) {
            if (length === pipeLengthTypes[i]) {
                return `pipe-type-${i + 1}`;
            }
        }
        return '';
    }

    // Right side pipes
    if (results.pipeLayoutRight && results.pipeLayoutRight.pipes) {
        for (const pipe of results.pipeLayoutRight.pipes) {
            const typeClass = getTypeClass(pipe.length);
            const row = document.createElement('tr');
            row.innerHTML = `<td>${rowNum++}</td><td>Prawa</td><td>${Math.round(pipe.startX)}</td><td>${Math.round(pipe.endX)}</td><td class="${typeClass}">${pipe.length}</td><td class="${typeClass}">${pipe.length}mm</td>`;
            tbody.appendChild(row);
        }
    }

    // Left side pipes
    if (results.pipeLayoutLeft && results.pipeLayoutLeft.pipes) {
        for (const pipe of results.pipeLayoutLeft.pipes) {
            const typeClass = getTypeClass(pipe.length);
            const row = document.createElement('tr');
            row.innerHTML = `<td>${rowNum++}</td><td>Lewa</td><td>${Math.round(pipe.startX)}</td><td>${Math.round(pipe.endX)}</td><td class="${typeClass}">${pipe.length}</td><td class="${typeClass}">${pipe.length}mm</td>`;
            tbody.appendChild(row);
        }
    }
}

/**
 * Render connector positions table.
 */
function renderConnectorTable(results) {
    const tbody = document.querySelector('#connectorTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let rowNum = 1;

    // Right side connectors
    if (results.pipeLayoutRight && results.pipeLayoutRight.connectors) {
        for (const conn of results.pipeLayoutRight.connectors) {
            const { module: nearMod } = findNearestModule(conn.position, results.modulesRight);
            const row = document.createElement('tr');
            row.innerHTML = `<td>${rowNum++}</td><td>Prawa</td><td>${Math.round(conn.position)}</td><td>Modul #${nearMod ? nearMod.index + 1 : '?'}</td>`;
            tbody.appendChild(row);
        }
    }

    // Left side connectors
    if (results.pipeLayoutLeft && results.pipeLayoutLeft.connectors) {
        for (const conn of results.pipeLayoutLeft.connectors) {
            const { module: nearMod } = findNearestModule(conn.position, results.modulesLeft);
            const row = document.createElement('tr');
            row.innerHTML = `<td>${rowNum++}</td><td>Lewa</td><td>${Math.round(conn.position)}</td><td>Modul #${nearMod ? nearMod.index + 1 : '?'}</td>`;
            tbody.appendChild(row);
        }
    }
}

/**
 * Render summary table.
 */
function renderSummaryTable(results) {
    const tbody = document.querySelector('#summaryTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const raster = results.raster;
    const totalModules = results.params.modulesLeft + results.params.modulesRight;
    const totalSupports = 1 + (results.supportPostsRight ? results.supportPostsRight.length : 0) + (results.supportPostsLeft ? results.supportPostsLeft.length : 0);
    const totalPipes = (results.pipeLayoutRight ? results.pipeLayoutRight.pipes.length : 0) + (results.pipeLayoutLeft ? results.pipeLayoutLeft.pipes.length : 0);
    const totalConnectors = (results.pipeLayoutRight ? results.pipeLayoutRight.connectors.length : 0) + (results.pipeLayoutLeft ? results.pipeLayoutLeft.connectors.length : 0);

    // Total tracker length
    const lastModRight = results.modulesRight.length > 0 ? results.modulesRight[results.modulesRight.length - 1].absOuterEdge : 0;
    const lastModLeft = results.modulesLeft.length > 0 ? results.modulesLeft[results.modulesLeft.length - 1].absOuterEdge : 0;
    const totalLength = lastModRight + lastModLeft;

    const rows = [
        ['Raster modulu', `${raster} mm`],
        ['Calkowita liczba modulow', `${totalModules}`],
        ['Dlugosc calkowita trackera', `${Math.round(totalLength)} mm (${(totalLength / 1000).toFixed(1)} m)`],
        ['Liczba slupkow', `${totalSupports}`],
        ['Liczba rur', `${totalPipes}`],
        ['Liczba zlaczek', `${totalConnectors}`],
        ['Unikalne dlugosci rur', `${results.pipeLengthTypes.length}`],
        ['Rozstaw A', `${getSpacing('A', raster)} mm (${SPACING_TYPES.A.multiplier} x raster)`],
        ['Rozstaw B', `${getSpacing('B', raster)} mm (${SPACING_TYPES.B.multiplier} x raster)`],
        ['Rozstaw C', `${getSpacing('C', raster)} mm (${SPACING_TYPES.C.multiplier} x raster)`]
    ];

    for (const [param, value] of rows) {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${param}</td><td>${value}</td>`;
        tbody.appendChild(row);
    }
}

/**
 * Render optimization table.
 */
function renderOptimizationTable(catalog) {
    const tbody = document.querySelector('#optimizationTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (catalog.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="3">Brak danych - uruchom obliczenia</td>';
        tbody.appendChild(row);
        return;
    }

    for (const item of catalog) {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${item.length}</td><td>${item.count}</td><td>${item.usage}</td>`;
        tbody.appendChild(row);
    }
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', initUI);
