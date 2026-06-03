'use client';

/**
 * GlobeMap — Interactive 3D WebGL Node Globe
 *
 * Data layers:
 *  - Earth texture   : satellite (night) / terrain (day) / minimal (political)
 *  - Country borders : GeoJSON polygon layer (Natural Earth 110m)
 *  - Country names   : labels derived from GeoJSON feature centroids (minimal mode)
 *  - City markers    : ~100 major world cities with name + dot labels
 *  - Node points     : live node data (coloured by status)
 *  - Ring pulse      : amber animation on selected node
 *  - Hex-bin density : session-weighted columns (optional)
 */

import Globe from 'react-globe.gl';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { NodeGeoPoint } from '@/lib/services/explorer';
import type { MapNodeUpdate } from '@/components/map/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MapStyle = 'satellite' | 'terrain' | 'minimal';

export interface Props {
    nodes: NodeGeoPoint[];
    onSelectNode: (node: NodeGeoPoint) => void;
    selectedNodeId?: string;
    showHeatmap?: boolean;
    mapStyle?: MapStyle;
    focusBounds?: [[number, number], [number, number]] | null;
    liveUpdates?: MapNodeUpdate[];
}

// ─── Map style configs ────────────────────────────────────────────────────────

interface StyleConfig {
    globeImage: string;
    bump: string;
    background: string;
    atmosphere: string;
    polyCapColor: string;
    polySideColor: string;
    polyStrokeColor: string;
    labelColor: string;
}

const STYLES: Record<MapStyle, StyleConfig> = {
    satellite: {
        globeImage:      'https://unpkg.com/three-globe/example/img/earth-night.jpg',
        bump:            'https://unpkg.com/three-globe/example/img/earth-topology.png',
        background:      'https://unpkg.com/three-globe/example/img/night-sky.png',
        atmosphere:      '#6366f1',
        polyCapColor:    'rgba(0,0,0,0)',
        polySideColor:   'rgba(99,102,241,0.06)',
        polyStrokeColor: 'rgba(160,163,255,0.45)',
        labelColor:      'rgba(255,255,255,0.92)',
    },
    terrain: {
        globeImage:      'https://unpkg.com/three-globe/example/img/earth-day.jpg',
        bump:            'https://unpkg.com/three-globe/example/img/earth-topology.png',
        background:      'https://unpkg.com/three-globe/example/img/night-sky.png',
        atmosphere:      '#4a90d9',
        polyCapColor:    'rgba(0,0,0,0)',
        polySideColor:   'rgba(0,0,0,0.08)',
        polyStrokeColor: 'rgba(30,30,30,0.6)',
        labelColor:      'rgba(15,15,15,0.95)',
    },
    minimal: {
        // Empty globeImageUrl = plain dark sphere; countries filled via polygons
        globeImage:      '',
        bump:            '',
        background:      'https://unpkg.com/three-globe/example/img/night-sky.png',
        atmosphere:      '#6366f1',
        polyCapColor:    'rgba(12,16,40,0.92)',
        polySideColor:   'rgba(99,102,241,0.18)',
        polyStrokeColor: 'rgba(180,183,255,0.85)',
        labelColor:      'rgba(220,225,255,0.95)',
    },
};

// ─── Major world cities ───────────────────────────────────────────────────────
// tier: 5 = megacity (>15M), 1 = regional capital (<2M)

interface City { name: string; lat: number; lon: number; tier: number; }

const CITIES: City[] = [
    // ── East Asia ────────────────────────────────────────────────────────────
    { name: 'Tokyo',           lat:  35.69,  lon:  139.69, tier: 5 },
    { name: 'Shanghai',        lat:  31.23,  lon:  121.47, tier: 5 },
    { name: 'Beijing',         lat:  39.91,  lon:  116.39, tier: 5 },
    { name: 'Chongqing',       lat:  29.56,  lon:  106.55, tier: 5 },
    { name: 'Seoul',           lat:  37.57,  lon:  126.98, tier: 4 },
    { name: 'Osaka',           lat:  34.69,  lon:  135.50, tier: 4 },
    { name: 'Guangzhou',       lat:  23.13,  lon:  113.26, tier: 4 },
    { name: 'Shenzhen',        lat:  22.54,  lon:  114.06, tier: 4 },
    { name: 'Tianjin',         lat:  39.09,  lon:  117.20, tier: 4 },
    { name: 'Chengdu',         lat:  30.57,  lon:  104.07, tier: 3 },
    { name: 'Wuhan',           lat:  30.59,  lon:  114.30, tier: 3 },
    { name: "Xi'an",           lat:  34.27,  lon:  108.95, tier: 3 },
    { name: 'Nanjing',         lat:  32.06,  lon:  118.78, tier: 3 },
    { name: 'Hangzhou',        lat:  30.25,  lon:  120.15, tier: 3 },
    { name: 'Shenyang',        lat:  41.79,  lon:  123.43, tier: 3 },
    { name: 'Harbin',          lat:  45.75,  lon:  126.64, tier: 3 },
    { name: 'Qingdao',         lat:  36.07,  lon:  120.37, tier: 2 },
    { name: 'Zhengzhou',       lat:  34.75,  lon:  113.66, tier: 2 },
    { name: 'Jinan',           lat:  36.68,  lon:  117.00, tier: 2 },
    { name: 'Kunming',         lat:  25.05,  lon:  102.71, tier: 2 },
    { name: 'Urumqi',          lat:  43.82,  lon:   87.61, tier: 2 },
    { name: 'Hong Kong',       lat:  22.33,  lon:  114.17, tier: 3 },
    { name: 'Taipei',          lat:  25.05,  lon:  121.53, tier: 3 },
    { name: 'Pyongyang',       lat:  39.03,  lon:  125.75, tier: 2 },
    { name: 'Busan',           lat:  35.10,  lon:  129.04, tier: 2 },
    { name: 'Nagoya',          lat:  35.18,  lon:  136.91, tier: 2 },
    { name: 'Sapporo',         lat:  43.07,  lon:  141.35, tier: 2 },
    { name: 'Fukuoka',         lat:  33.59,  lon:  130.40, tier: 1 },
    { name: 'Ulaanbaatar',     lat:  47.90,  lon:  106.91, tier: 2 },
    // ── South & Southeast Asia ───────────────────────────────────────────────
    { name: 'Delhi',           lat:  28.61,  lon:   77.21, tier: 5 },
    { name: 'Mumbai',          lat:  19.08,  lon:   72.88, tier: 5 },
    { name: 'Dhaka',           lat:  23.72,  lon:   90.41, tier: 5 },
    { name: 'Karachi',         lat:  24.86,  lon:   67.01, tier: 5 },
    { name: 'Jakarta',         lat:  -6.21,  lon:  106.85, tier: 5 },
    { name: 'Kolkata',         lat:  22.57,  lon:   88.36, tier: 4 },
    { name: 'Manila',          lat:  14.60,  lon:  120.98, tier: 4 },
    { name: 'Lahore',          lat:  31.55,  lon:   74.35, tier: 4 },
    { name: 'Bangalore',       lat:  12.97,  lon:   77.59, tier: 4 },
    { name: 'Bangkok',         lat:  13.75,  lon:  100.51, tier: 3 },
    { name: 'Ho Chi Minh',     lat:  10.82,  lon:  106.63, tier: 3 },
    { name: 'Singapore',       lat:   1.35,  lon:  103.82, tier: 3 },
    { name: 'Kuala Lumpur',    lat:   3.14,  lon:  101.69, tier: 3 },
    { name: 'Hanoi',           lat:  21.03,  lon:  105.85, tier: 3 },
    { name: 'Chennai',         lat:  13.08,  lon:   80.27, tier: 3 },
    { name: 'Hyderabad',       lat:  17.38,  lon:   78.49, tier: 3 },
    { name: 'Surabaya',        lat:  -7.25,  lon:  112.75, tier: 3 },
    { name: 'Yangon',          lat:  16.87,  lon:   96.19, tier: 3 },
    { name: 'Colombo',         lat:   6.93,  lon:   79.85, tier: 2 },
    { name: 'Kathmandu',       lat:  27.70,  lon:   85.32, tier: 2 },
    { name: 'Phnom Penh',      lat:  11.57,  lon:  104.92, tier: 2 },
    { name: 'Vientiane',       lat:  17.97,  lon:  102.60, tier: 2 },
    { name: 'Islamabad',       lat:  33.72,  lon:   73.06, tier: 2 },
    { name: 'Pune',            lat:  18.52,  lon:   73.86, tier: 2 },
    { name: 'Ahmedabad',       lat:  23.02,  lon:   72.57, tier: 2 },
    { name: 'Surat',           lat:  21.17,  lon:   72.83, tier: 2 },
    { name: 'Chittagong',      lat:  22.34,  lon:   91.84, tier: 2 },
    { name: 'Bandung',         lat:  -6.91,  lon:  107.61, tier: 2 },
    { name: 'Medan',           lat:   3.59,  lon:   98.67, tier: 2 },
    { name: 'Cebu',            lat:  10.32,  lon:  123.89, tier: 1 },
    { name: 'Davao',           lat:   7.07,  lon:  125.61, tier: 1 },
    { name: 'Nay Pyi Taw',     lat:  19.74,  lon:   96.12, tier: 1 },
    { name: 'Bandar Seri',     lat:   4.94,  lon:  114.94, tier: 1 },
    { name: 'Dili',            lat:  -8.56,  lon:  125.58, tier: 1 },
    { name: 'Malé',            lat:   4.17,  lon:   73.51, tier: 1 },
    { name: 'Thimphu',         lat:  27.47,  lon:   89.64, tier: 1 },
    // ── Central Asia ─────────────────────────────────────────────────────────
    { name: 'Tashkent',        lat:  41.30,  lon:   69.24, tier: 2 },
    { name: 'Almaty',          lat:  43.24,  lon:   76.89, tier: 2 },
    { name: 'Bishkek',         lat:  42.87,  lon:   74.59, tier: 1 },
    { name: 'Dushanbe',        lat:  38.56,  lon:   68.77, tier: 1 },
    { name: 'Ashgabat',        lat:  37.95,  lon:   58.38, tier: 1 },
    { name: 'Nur-Sultan',      lat:  51.18,  lon:   71.45, tier: 2 },
    { name: 'Kabul',           lat:  34.53,  lon:   69.17, tier: 2 },
    // ── Middle East & Caucasus ───────────────────────────────────────────────
    { name: 'Istanbul',        lat:  41.01,  lon:   28.95, tier: 4 },
    { name: 'Tehran',          lat:  35.69,  lon:   51.42, tier: 3 },
    { name: 'Riyadh',          lat:  24.69,  lon:   46.72, tier: 3 },
    { name: 'Baghdad',         lat:  33.34,  lon:   44.40, tier: 3 },
    { name: 'Ankara',          lat:  39.93,  lon:   32.85, tier: 2 },
    { name: 'Dubai',           lat:  25.20,  lon:   55.27, tier: 2 },
    { name: 'Doha',            lat:  25.29,  lon:   51.53, tier: 2 },
    { name: 'Amman',           lat:  31.95,  lon:   35.93, tier: 2 },
    { name: 'Beirut',          lat:  33.89,  lon:   35.50, tier: 2 },
    { name: 'Damascus',        lat:  33.51,  lon:   36.29, tier: 2 },
    { name: 'Tel Aviv',        lat:  32.08,  lon:   34.78, tier: 2 },
    { name: "Sana'a",          lat:  15.35,  lon:   44.21, tier: 2 },
    { name: 'Muscat',          lat:  23.61,  lon:   58.59, tier: 1 },
    { name: 'Kuwait City',     lat:  29.37,  lon:   47.97, tier: 1 },
    { name: 'Abu Dhabi',       lat:  24.45,  lon:   54.38, tier: 2 },
    { name: 'Baku',            lat:  40.41,  lon:   49.87, tier: 2 },
    { name: 'Tbilisi',         lat:  41.69,  lon:   44.83, tier: 2 },
    { name: 'Yerevan',         lat:  40.18,  lon:   44.51, tier: 2 },
    { name: 'Manama',          lat:  26.22,  lon:   50.59, tier: 1 },
    { name: 'Izmir',           lat:  38.42,  lon:   27.14, tier: 2 },
    { name: 'Mashhad',         lat:  36.30,  lon:   59.60, tier: 2 },
    { name: 'Isfahan',         lat:  32.65,  lon:   51.68, tier: 2 },
    // ── Russia ───────────────────────────────────────────────────────────────
    { name: 'Moscow',          lat:  55.75,  lon:   37.62, tier: 4 },
    { name: 'Saint Petersburg',lat:  59.93,  lon:   30.32, tier: 3 },
    { name: 'Novosibirsk',     lat:  54.99,  lon:   82.90, tier: 2 },
    { name: 'Yekaterinburg',   lat:  56.84,  lon:   60.60, tier: 2 },
    { name: 'Kazan',           lat:  55.79,  lon:   49.12, tier: 1 },
    { name: 'Vladivostok',     lat:  43.11,  lon:  131.87, tier: 1 },
    // ── Western & Northern Europe ─────────────────────────────────────────────
    { name: 'London',          lat:  51.51,  lon:   -0.13, tier: 4 },
    { name: 'Paris',           lat:  48.86,  lon:    2.35, tier: 4 },
    { name: 'Berlin',          lat:  52.52,  lon:   13.40, tier: 3 },
    { name: 'Madrid',          lat:  40.42,  lon:   -3.70, tier: 3 },
    { name: 'Rome',            lat:  41.90,  lon:   12.50, tier: 3 },
    { name: 'Amsterdam',       lat:  52.37,  lon:    4.89, tier: 2 },
    { name: 'Brussels',        lat:  50.85,  lon:    4.35, tier: 2 },
    { name: 'Vienna',          lat:  48.21,  lon:   16.37, tier: 2 },
    { name: 'Stockholm',       lat:  59.33,  lon:   18.07, tier: 2 },
    { name: 'Oslo',            lat:  59.91,  lon:   10.75, tier: 2 },
    { name: 'Copenhagen',      lat:  55.68,  lon:   12.57, tier: 2 },
    { name: 'Helsinki',        lat:  60.17,  lon:   24.94, tier: 2 },
    { name: 'Lisbon',          lat:  38.72,  lon:   -9.14, tier: 2 },
    { name: 'Athens',          lat:  37.98,  lon:   23.73, tier: 2 },
    { name: 'Barcelona',       lat:  41.39,  lon:    2.15, tier: 2 },
    { name: 'Milan',           lat:  45.47,  lon:    9.19, tier: 2 },
    { name: 'Hamburg',         lat:  53.55,  lon:    9.99, tier: 2 },
    { name: 'Munich',          lat:  48.14,  lon:   11.58, tier: 2 },
    { name: 'Zurich',          lat:  47.38,  lon:    8.54, tier: 1 },
    { name: 'Geneva',          lat:  46.20,  lon:    6.15, tier: 1 },
    { name: 'Dublin',          lat:  53.33,  lon:   -6.25, tier: 1 },
    { name: 'Edinburgh',       lat:  55.95,  lon:   -3.19, tier: 1 },
    { name: 'Lyon',            lat:  45.75,  lon:    4.83, tier: 1 },
    { name: 'Marseille',       lat:  43.30,  lon:    5.37, tier: 1 },
    { name: 'Frankfurt',       lat:  50.11,  lon:    8.68, tier: 1 },
    { name: 'Cologne',         lat:  50.94,  lon:    6.96, tier: 1 },
    { name: 'Seville',         lat:  37.39,  lon:   -5.99, tier: 1 },
    { name: 'Valencia',        lat:  39.47,  lon:   -0.38, tier: 1 },
    { name: 'Naples',          lat:  40.85,  lon:   14.27, tier: 1 },
    { name: 'Turin',           lat:  45.07,  lon:    7.69, tier: 1 },
    { name: 'Porto',           lat:  41.16,  lon:   -8.63, tier: 1 },
    { name: 'Rotterdam',       lat:  51.92,  lon:    4.48, tier: 1 },
    { name: 'Reykjavik',       lat:  64.14,  lon:  -21.94, tier: 1 },
    // ── Eastern Europe ─────────────────────────────────────────────────────
    { name: 'Kyiv',            lat:  50.45,  lon:   30.52, tier: 2 },
    { name: 'Warsaw',          lat:  52.23,  lon:   21.01, tier: 2 },
    { name: 'Bucharest',       lat:  44.44,  lon:   26.10, tier: 2 },
    { name: 'Budapest',        lat:  47.50,  lon:   19.04, tier: 2 },
    { name: 'Prague',          lat:  50.08,  lon:   14.44, tier: 2 },
    { name: 'Belgrade',        lat:  44.80,  lon:   20.46, tier: 1 },
    { name: 'Sofia',           lat:  42.70,  lon:   23.32, tier: 1 },
    { name: 'Minsk',           lat:  53.90,  lon:   27.57, tier: 1 },
    { name: 'Vilnius',         lat:  54.69,  lon:   25.28, tier: 1 },
    { name: 'Riga',            lat:  56.95,  lon:   24.11, tier: 1 },
    { name: 'Tallinn',         lat:  59.44,  lon:   24.75, tier: 1 },
    { name: 'Zagreb',          lat:  45.81,  lon:   15.98, tier: 1 },
    { name: 'Sarajevo',        lat:  43.85,  lon:   18.36, tier: 1 },
    { name: 'Skopje',          lat:  41.99,  lon:   21.43, tier: 1 },
    { name: 'Tirana',          lat:  41.33,  lon:   19.82, tier: 1 },
    { name: 'Chisinau',        lat:  47.00,  lon:   28.86, tier: 1 },
    { name: 'Ljubljana',       lat:  46.05,  lon:   14.51, tier: 1 },
    { name: 'Bratislava',      lat:  48.15,  lon:   17.11, tier: 1 },
    // ── North Africa ──────────────────────────────────────────────────────────
    { name: 'Cairo',           lat:  30.06,  lon:   31.25, tier: 4 },
    { name: 'Algiers',         lat:  36.74,  lon:    3.06, tier: 2 },
    { name: 'Casablanca',      lat:  33.59,  lon:   -7.62, tier: 2 },
    { name: 'Tunis',           lat:  36.82,  lon:   10.17, tier: 2 },
    { name: 'Tripoli',         lat:  32.90,  lon:   13.18, tier: 2 },
    { name: 'Khartoum',        lat:  15.55,  lon:   32.53, tier: 3 },
    { name: 'Alexandria',      lat:  31.20,  lon:   29.92, tier: 2 },
    // ── Sub-Saharan Africa ──────────────────────────────────────────────────
    { name: 'Lagos',           lat:   6.52,  lon:    3.37, tier: 5 },
    { name: 'Kinshasa',        lat:  -4.33,  lon:   15.32, tier: 4 },
    { name: 'Luanda',          lat:  -8.84,  lon:   13.23, tier: 3 },
    { name: 'Dar es Salaam',   lat:  -6.79,  lon:   39.21, tier: 3 },
    { name: 'Abidjan',         lat:   5.35,  lon:   -4.00, tier: 3 },
    { name: 'Johannesburg',    lat: -26.20,  lon:   28.04, tier: 3 },
    { name: 'Nairobi',         lat:  -1.29,  lon:   36.82, tier: 2 },
    { name: 'Addis Ababa',     lat:   9.03,  lon:   38.74, tier: 2 },
    { name: 'Accra',           lat:   5.56,  lon:   -0.20, tier: 2 },
    { name: 'Dakar',           lat:  14.72,  lon:  -17.47, tier: 2 },
    { name: 'Abuja',           lat:   9.07,  lon:    7.40, tier: 2 },
    { name: 'Kampala',         lat:   0.32,  lon:   32.58, tier: 2 },
    { name: 'Cape Town',       lat: -33.93,  lon:   18.42, tier: 2 },
    { name: 'Douala',          lat:   4.05,  lon:    9.70, tier: 2 },
    { name: 'Kigali',          lat:  -1.95,  lon:   30.06, tier: 1 },
    { name: 'Lusaka',          lat: -15.42,  lon:   28.28, tier: 1 },
    { name: 'Harare',          lat: -17.83,  lon:   31.05, tier: 1 },
    { name: 'Maputo',          lat: -25.97,  lon:   32.57, tier: 1 },
    { name: 'Antananarivo',    lat: -18.91,  lon:   47.54, tier: 1 },
    { name: 'Bamako',          lat:  12.65,  lon:   -8.00, tier: 1 },
    { name: 'Ouagadougou',     lat:  12.37,  lon:   -1.52, tier: 1 },
    { name: 'Niamey',          lat:  13.51,  lon:    2.12, tier: 1 },
    { name: "N'Djamena",       lat:  12.11,  lon:   15.04, tier: 1 },
    { name: 'Conakry',         lat:   9.54,  lon:  -13.68, tier: 1 },
    { name: 'Yaoundé',         lat:   3.87,  lon:   11.52, tier: 1 },
    { name: 'Mogadishu',       lat:   2.05,  lon:   45.34, tier: 1 },
    { name: 'Juba',            lat:   4.85,  lon:   31.60, tier: 1 },
    { name: 'Brazzaville',     lat:  -4.27,  lon:   15.28, tier: 1 },
    { name: 'Windhoek',        lat: -22.56,  lon:   17.08, tier: 1 },
    { name: 'Gaborone',        lat: -24.65,  lon:   25.91, tier: 1 },
    { name: 'Hargeisa',        lat:   9.56,  lon:   44.06, tier: 1 },
    { name: 'Freetown',        lat:   8.49,  lon:  -13.23, tier: 1 },
    { name: 'Monrovia',        lat:   6.30,  lon:  -10.80, tier: 1 },
    { name: 'Libreville',      lat:   0.39,  lon:    9.45, tier: 1 },
    { name: 'Bangui',          lat:   4.36,  lon:   18.55, tier: 1 },
    { name: 'Djibouti',        lat:  11.59,  lon:   43.15, tier: 1 },
    { name: 'Asmara',          lat:  15.34,  lon:   38.93, tier: 1 },
    { name: 'Lilongwe',        lat: -13.97,  lon:   33.79, tier: 1 },
    { name: 'Dodoma',          lat:  -6.18,  lon:   35.74, tier: 1 },
    { name: 'Lomé',            lat:   6.14,  lon:    1.22, tier: 1 },
    { name: 'Cotonou',         lat:   6.37,  lon:    2.42, tier: 1 },
    { name: 'Porto-Novo',      lat:   6.50,  lon:    2.63, tier: 1 },
    { name: 'Banjul',          lat:  13.45,  lon:  -16.58, tier: 1 },
    { name: 'Bissau',          lat:  11.86,  lon:  -15.60, tier: 1 },
    { name: 'Malabo',          lat:   3.75,  lon:    8.78, tier: 1 },
    { name: 'São Tomé',        lat:   0.34,  lon:    6.73, tier: 1 },
    { name: "M'beki",          lat: -25.75,  lon:   28.21, tier: 1 }, // Pretoria
    { name: 'Durban',          lat: -29.86,  lon:   31.02, tier: 1 },
    { name: 'Mombasa',         lat:  -4.05,  lon:   39.67, tier: 1 },
    // ── North America ────────────────────────────────────────────────────────
    { name: 'New York',        lat:  40.71,  lon:  -74.01, tier: 4 },
    { name: 'Mexico City',     lat:  19.43,  lon:  -99.13, tier: 5 },
    { name: 'Los Angeles',     lat:  34.05,  lon: -118.24, tier: 3 },
    { name: 'Chicago',         lat:  41.88,  lon:  -87.63, tier: 3 },
    { name: 'Toronto',         lat:  43.65,  lon:  -79.38, tier: 3 },
    { name: 'Houston',         lat:  29.76,  lon:  -95.37, tier: 2 },
    { name: 'Miami',           lat:  25.77,  lon:  -80.19, tier: 2 },
    { name: 'Washington DC',   lat:  38.91,  lon:  -77.04, tier: 2 },
    { name: 'Montreal',        lat:  45.50,  lon:  -73.57, tier: 2 },
    { name: 'Dallas',          lat:  32.78,  lon:  -96.80, tier: 2 },
    { name: 'San Francisco',   lat:  37.77,  lon: -122.42, tier: 2 },
    { name: 'Seattle',         lat:  47.61,  lon: -122.33, tier: 2 },
    { name: 'Atlanta',         lat:  33.75,  lon:  -84.39, tier: 2 },
    { name: 'Boston',          lat:  42.36,  lon:  -71.06, tier: 1 },
    { name: 'Phoenix',         lat:  33.45,  lon: -112.07, tier: 1 },
    { name: 'Denver',          lat:  39.74,  lon: -104.98, tier: 1 },
    { name: 'Minneapolis',     lat:  44.98,  lon:  -93.27, tier: 1 },
    { name: 'Detroit',         lat:  42.33,  lon:  -83.05, tier: 1 },
    { name: 'Vancouver',       lat:  49.25,  lon: -123.12, tier: 1 },
    { name: 'Calgary',         lat:  51.05,  lon: -114.07, tier: 1 },
    { name: 'Ottawa',          lat:  45.42,  lon:  -75.69, tier: 1 },
    { name: 'Guadalajara',     lat:  20.67,  lon: -103.35, tier: 2 },
    { name: 'Monterrey',       lat:  25.67,  lon: -100.31, tier: 2 },
    { name: 'Havana',          lat:  23.13,  lon:  -82.38, tier: 2 },
    { name: 'Santo Domingo',   lat:  18.47,  lon:  -69.90, tier: 1 },
    { name: 'San Juan',        lat:  18.47,  lon:  -66.11, tier: 1 },
    { name: 'Guatemala City',  lat:  14.64,  lon:  -90.51, tier: 1 },
    { name: 'San José',        lat:   9.93,  lon:  -84.09, tier: 1 },
    { name: 'Panama City',     lat:   8.99,  lon:  -79.52, tier: 1 },
    { name: 'Tegucigalpa',     lat:  14.09,  lon:  -87.21, tier: 1 },
    { name: 'Managua',         lat:  12.13,  lon:  -86.28, tier: 1 },
    { name: 'San Salvador',    lat:  13.69,  lon:  -89.19, tier: 1 },
    { name: 'Port-au-Prince',  lat:  18.54,  lon:  -72.34, tier: 1 },
    { name: 'Kingston',        lat:  18.00,  lon:  -76.79, tier: 1 },
    { name: 'Nassau',          lat:  25.08,  lon:  -77.35, tier: 1 },
    // ── South America ────────────────────────────────────────────────────────
    { name: 'São Paulo',       lat: -23.55,  lon:  -46.63, tier: 5 },
    { name: 'Buenos Aires',    lat: -34.60,  lon:  -58.38, tier: 4 },
    { name: 'Rio de Janeiro',  lat: -22.91,  lon:  -43.17, tier: 4 },
    { name: 'Lima',            lat: -12.05,  lon:  -77.04, tier: 3 },
    { name: 'Bogotá',          lat:   4.71,  lon:  -74.07, tier: 3 },
    { name: 'Santiago',        lat: -33.46,  lon:  -70.65, tier: 3 },
    { name: 'Caracas',         lat:  10.48,  lon:  -66.88, tier: 3 },
    { name: 'Belo Horizonte',  lat: -19.92,  lon:  -43.94, tier: 2 },
    { name: 'Medellín',        lat:   6.23,  lon:  -75.57, tier: 2 },
    { name: 'Quito',           lat:  -0.23,  lon:  -78.52, tier: 2 },
    { name: 'Guayaquil',       lat:  -2.17,  lon:  -79.92, tier: 2 },
    { name: 'Montevideo',      lat: -34.90,  lon:  -56.17, tier: 2 },
    { name: 'La Paz',          lat: -16.50,  lon:  -68.15, tier: 2 },
    { name: 'Asunción',        lat: -25.28,  lon:  -57.65, tier: 2 },
    { name: 'Porto Alegre',    lat: -30.03,  lon:  -51.23, tier: 2 },
    { name: 'Recife',          lat:  -8.05,  lon:  -34.88, tier: 2 },
    { name: 'Salvador',        lat: -12.97,  lon:  -38.50, tier: 2 },
    { name: 'Fortaleza',       lat:  -3.72,  lon:  -38.54, tier: 2 },
    { name: 'Manaus',          lat:  -3.10,  lon:  -60.03, tier: 2 },
    { name: 'Brasília',        lat: -15.77,  lon:  -47.92, tier: 2 },
    { name: 'Curitiba',        lat: -25.43,  lon:  -49.27, tier: 1 },
    { name: 'Belém',           lat:  -1.45,  lon:  -48.50, tier: 1 },
    { name: 'Georgetown',      lat:   6.80,  lon:  -58.16, tier: 1 },
    { name: 'Paramaribo',      lat:   5.85,  lon:  -55.20, tier: 1 },
    { name: 'Cayenne',         lat:   4.94,  lon:  -52.33, tier: 1 },
    { name: 'Sucre',           lat: -19.03,  lon:  -65.26, tier: 1 },
    // ── Oceania ─────────────────────────────────────────────────────────────
    { name: 'Sydney',          lat: -33.87,  lon:  151.21, tier: 2 },
    { name: 'Melbourne',       lat: -37.81,  lon:  144.96, tier: 2 },
    { name: 'Brisbane',        lat: -27.47,  lon:  153.02, tier: 2 },
    { name: 'Perth',           lat: -31.95,  lon:  115.86, tier: 2 },
    { name: 'Adelaide',        lat: -34.93,  lon:  138.60, tier: 1 },
    { name: 'Auckland',        lat: -36.87,  lon:  174.77, tier: 2 },
    { name: 'Wellington',      lat: -41.29,  lon:  174.78, tier: 1 },
    { name: 'Canberra',        lat: -35.28,  lon:  149.13, tier: 1 },
    { name: 'Port Moresby',    lat:  -9.45,  lon:  147.19, tier: 1 },
    { name: 'Suva',            lat: -18.14,  lon:  178.44, tier: 1 },
    { name: 'Honolulu',        lat:  21.31,  lon: -157.86, tier: 1 },
    { name: 'Honiara',         lat:  -9.43,  lon:  160.05, tier: 1 },
    { name: 'Nuku\'alofa',     lat: -21.14,  lon: -175.22, tier: 1 },
    { name: 'Apia',            lat: -13.83,  lon: -171.77, tier: 1 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pointColor(n: NodeGeoPoint, selId?: string): string {
    if (selId === n.node_id) return '#f59e0b';
    if (n.is_validator)      return '#a855f7';
    if (n.is_active)         return '#10b981';
    return '#ef4444';
}
function pointRadius(n: NodeGeoPoint)   { return n.is_validator ? 0.06 : 0.04; }
function pointAltitude(n: NodeGeoPoint) { return n.is_active ? 0.025 : 0.008; }

function nodeTooltip(n: NodeGeoPoint): string {
    const sc  = n.is_active ? '#10b981' : '#ef4444';
    const st  = n.is_active ? '● Active' : '○ Offline';
    const ty  = n.is_validator ? '⬡ Validator' : '◎ Proxy';
    const loc = [n.city, n.country || n.region].filter(Boolean).join(', ') || '—';
    return `<div style="background:#0a0a15;border:1px solid rgba(99,102,241,.4);border-radius:10px;
                padding:10px 14px;font-family:monospace;color:#fff;min-width:190px;
                box-shadow:0 4px 28px rgba(0,0,0,.9);pointer-events:none;">
        <div style="color:#6366f1;font-weight:700;font-size:10px;margin-bottom:5px;">
            ${n.node_id.slice(0, 22)}…
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:3px;">
            <span style="color:rgba(255,255,255,.4)">${ty}</span>
            <span style="color:${sc};font-weight:700;">${st}</span>
        </div>
        <div style="color:rgba(255,255,255,.45);font-size:9px;margin-bottom:2px;">📍 ${loc}</div>
        <div style="color:rgba(255,255,255,.35);font-size:9px;">
            ${(n.uptime_percent || 0).toFixed(1)}% up · ${n.active_sessions} sessions
        </div>
    </div>`;
}

function hexTooltip(d: object): string {
    const hex    = d as { points: NodeGeoPoint[]; sumWeight: number };
    const active = hex.points.filter(p => p.is_active).length;
    return `<div style="background:#0a0a15;border:1px solid rgba(99,102,241,.3);border-radius:8px;
                padding:7px 12px;font-family:monospace;font-size:9px;color:#fff;pointer-events:none;">
        <span style="color:#6366f1;font-weight:700;">${hex.points.length}</span> nodes ·
        <span style="color:#10b981;">${active}</span> active ·
        <span style="color:#a855f7;">${Math.round(hex.sumWeight)}</span> sessions
    </div>`;
}

function ringCentroid(ring: number[][]): [number, number] {
    let lat = 0, lon = 0;
    for (const [lo, la] of ring) { lon += lo; lat += la; }
    return [lat / ring.length, lon / ring.length];
}

function featureCentroid(f: any): [number, number] | null {
    try {
        const { type, coordinates: c } = f.geometry;
        if (type === 'Polygon') return ringCentroid(c[0]);
        if (type === 'MultiPolygon') {
            let best = c[0][0];
            for (const poly of c) if (poly[0].length > best.length) best = poly[0];
            return ringCentroid(best);
        }
    } catch { /* skip malformed features */ }
    return null;
}

const COUNTRIES_GEOJSON =
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';

// Natural Earth 50m populated places — ~7,000+ cities
const POPULATED_PLACES_URL =
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places_simple.geojson';

function popToTier(pop: number): number {
    if (pop >= 10_000_000) return 5;
    if (pop >=  3_000_000) return 4;
    if (pop >=  1_000_000) return 3;
    if (pop >=    300_000) return 2;
    return 1;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GlobeMap({
    nodes,
    onSelectNode,
    selectedNodeId,
    showHeatmap = false,
    mapStyle    = 'satellite',
    focusBounds,
    liveUpdates = [],
}: Props) {
    const globeRef     = useRef<any>(null);
    const nodeMapRef   = useRef<Map<string, NodeGeoPoint>>(new Map());
    const containerRef = useRef<HTMLDivElement>(null);

    const [displayNodes, setDisplayNodes] = useState<NodeGeoPoint[]>([]);
    const [size, setSize]         = useState({ w: 800, h: 680 });
    const [countries, setCountries] = useState<any[]>([]);
    // Starts with the static fallback; replaced by the Natural Earth fetch once loaded
    const [cityData, setCityData] = useState<City[]>(CITIES);

    const style = STYLES[mapStyle];

    const MAX_CITY_LABELS = 120;
    const MAX_COUNTRY_LABELS = 48;
    const MAX_TRAFFIC_ARCS = 50;

    // ── City labels sized by tier (cap count for WebGL performance) ──
    const cityLabels = useMemo(() =>
        [...cityData]
            .sort((a, b) => b.tier - a.tier)
            .slice(0, MAX_CITY_LABELS)
            .map(c => ({
                ...c,
                labelSize:  0.12 + c.tier * 0.06,  // 0.18–0.42 degrees
                dotRadius:  0.06 + c.tier * 0.035,
            })),
    [cityData]);

    // ── Country name labels derived from loaded GeoJSON centroids ──
    const countryLabels = useMemo(() =>
        countries.flatMap(f => {
            const pt = featureCentroid(f);
            if (!pt) return [];
            const name: string = f.properties?.NAME_EN || f.properties?.NAME || '';
            if (!name) return [];
            return [{ name, lat: pt[0], lon: pt[1], labelSize: 0.3, dotRadius: 0 }];
        }).slice(0, MAX_COUNTRY_LABELS),
    [countries]);

    // ── ResizeObserver: exact dimensions → pointer events correctly aligned ──
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width > 10 && height > 10) setSize({ w: Math.floor(width), h: Math.floor(height) });
        });
        ro.observe(el);
        const { clientWidth: w, clientHeight: h } = el;
        if (w > 10 && h > 10) setSize({ w, h });
        return () => ro.disconnect();
    }, []);

    // ── Load country polygon GeoJSON once ──
    useEffect(() => {
        fetch(COUNTRIES_GEOJSON)
            .then(r => r.json())
            .then(d => setCountries(d.features ?? []))
            .catch(() => {});
    }, []);

    // ── Load Natural Earth populated places (~1,245 cities with POP_MAX) ──
    // Falls back to the static CITIES array if the fetch fails or is slow.
    useEffect(() => {
        fetch(POPULATED_PLACES_URL)
            .then(r => r.json())
            .then(d => {
                const cities: City[] = (d.features ?? [])
                    .filter((f: any) => f.geometry?.type === 'Point' && (f.properties?.NAMEASCII || f.properties?.name))
                    .map((f: any) => ({
                        name: (f.properties.NAMEASCII || f.properties.name) as string,
                        lat:  f.geometry.coordinates[1] as number,
                        lon:  f.geometry.coordinates[0] as number,
                        tier: popToTier(f.properties.pop_max || f.properties.POP_MAX || 0),
                    }));
                if (cities.length > 50) setCityData(cities);
            })
            .catch(() => {}); // keep static CITIES fallback on network error
    }, []);

    // ── Sync nodes from props ──
    useEffect(() => {
        nodeMapRef.current = new Map(nodes.map(n => [n.node_id, n]));
        setDisplayNodes([...nodes]);
    }, [nodes]);

    // ── Merge live WS updates in-place ──
    useEffect(() => {
        if (!liveUpdates.length) return;
        let changed = false;
        for (const u of liveUpdates) {
            const cur = nodeMapRef.current.get(u.node_id);
            if (cur) {
                nodeMapRef.current.set(u.node_id, {
                    ...cur, is_active: u.is_active,
                    uptime_percent: u.uptime_percent, active_sessions: u.active_sessions,
                    lat: u.lat ?? cur.lat, lon: u.lon ?? cur.lon,
                });
                changed = true;
            } else if (u.lat && Math.abs(u.lat) > 0.001) {
                nodeMapRef.current.set(u.node_id, {
                    node_id: u.node_id, lat: u.lat, lon: u.lon ?? 0,
                    is_active: u.is_active, is_validator: false,
                    uptime_percent: u.uptime_percent, active_sessions: u.active_sessions,
                    country: '', region: '',
                });
                changed = true;
            }
        }
        if (changed) setDisplayNodes([...nodeMapRef.current.values()]);
    }, [liveUpdates]);

    // ── Init OrbitControls after globe mounts ──
    const initControls = useCallback((): (() => void) => {
        const g = globeRef.current;
        if (!g) return () => {};
        try {
            const controls          = g.controls();
            controls.autoRotate      = true;
            controls.autoRotateSpeed = 0.3;
            controls.enableDamping   = true;
            controls.dampingFactor   = 0.1;
            controls.enableZoom      = true;
            controls.enableRotate    = true;
            controls.enablePan       = false;
            controls.minDistance     = 110;
            controls.maxDistance     = 500;
            controls.zoomSpeed       = 0.8;
            const canvas = g.renderer().domElement as HTMLCanvasElement;
            canvas.style.cursor = 'grab';
            const onDown = () => {
                controls.autoRotate = false;
                canvas.style.cursor = 'grabbing';
            };
            const onUp = () => {
                canvas.style.cursor = 'grab';
            };
            canvas.addEventListener('pointerdown', onDown, { passive: true });
            canvas.addEventListener('pointerup', onUp, { passive: true });
            return () => {
                canvas.removeEventListener('pointerdown', onDown);
                canvas.removeEventListener('pointerup', onUp);
            };
        } catch (_) {
            return () => {};
        }
    }, []);

    useEffect(() => {
        let removeListeners: (() => void) | undefined;
        const t = setTimeout(() => {
            removeListeners = initControls();
        }, 500);
        return () => {
            clearTimeout(t);
            removeListeners?.();
        };
    }, [initControls, size.w, size.h]);

    useEffect(() => () => {
        try {
            globeRef.current?.renderer()?.dispose();
        } catch (_) {}
    }, []);

    // ── Camera fly-to on region filter ──
    useEffect(() => {
        const g = globeRef.current;
        if (!g || !focusBounds) return;
        const [[swLat, swLon], [neLat, neLon]] = focusBounds;
        g.pointOfView({ lat: (swLat + neLat) / 2, lng: (swLon + neLon) / 2, altitude: 1.6 }, 1200);
    }, [focusBounds]);

    useEffect(() => {
        const g = globeRef.current;
        if (!g || focusBounds !== null) return;
        g.pointOfView({ lat: 20, lng: 0, altitude: 2.2 }, 1200);
    }, [focusBounds]);

    const handlePointClick = useCallback((point: object) => {
        try { const c = globeRef.current?.controls(); if (c) c.autoRotate = false; } catch (_) {}
        onSelectNode(point as NodeGeoPoint);
    }, [onSelectNode]);

    const validNodes   = displayNodes.filter(n => Math.abs(n.lat) > 0.001 || Math.abs(n.lon) > 0.001);
    const selectedNode = selectedNodeId ? validNodes.find(n => n.node_id === selectedNodeId) ?? null : null;

    // All modes show city labels; minimal mode also overlays country name labels
    const activeLabels = useMemo(
        () => mapStyle === 'minimal' ? [...cityLabels, ...countryLabels] : cityLabels,
        [mapStyle, cityLabels, countryLabels],
    );

    // ── Traffic Arcs: Connect active nodes to a Nexus hub (Central Hub) ──
    const NEXUS = { lat: 51.5074, lon: -0.1278 }; // London as a central nexus
    const trafficArcs = useMemo(() =>
        validNodes
            .filter(n => n.is_active)
            .slice(0, MAX_TRAFFIC_ARCS)
            .map(n => ({
                startLat: n.lat,
                startLng: n.lon,
                endLat: NEXUS.lat,
                endLng: NEXUS.lon,
                color: ['rgba(99,102,241,0.4)', 'rgba(168,85,247,0.4)'],
            })),
        [validNodes]
    );

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#050508' }}>
            <Globe
                ref={globeRef}
                width={size.w}
                height={size.h}

                // ── Texture (switches with mapStyle) ──────────────────────
                globeImageUrl={style.globeImage || undefined}
                bumpImageUrl={style.bump || undefined}
                backgroundImageUrl={style.background}
                atmosphereColor={style.atmosphere}
                atmosphereAltitude={0.22}

                // ── Country border polygons ────────────────────────────────
                polygonsData={countries}
                polygonCapColor={() => style.polyCapColor}
                polygonSideColor={() => style.polySideColor}
                polygonStrokeColor={() => style.polyStrokeColor}
                polygonAltitude={0.001}

                // ── City / country labels ──────────────────────────────────
                labelsData={activeLabels}
                labelLat={(d: object) => (d as any).lat}
                labelLng={(d: object) => (d as any).lon}
                labelText={(d: object) => (d as any).name}
                labelSize={(d: object) => (d as any).labelSize ?? 0.2}
                labelDotRadius={(d: object) => (d as any).dotRadius ?? 0.1}
                labelColor={() => style.labelColor}
                labelAltitude={0.015}
                labelResolution={3}
                labelDotOrientation={() => 'bottom' as const}

                // ── Node points ───────────────────────────────────────────
                pointsData={validNodes}
                pointLat="lat"
                pointLng="lon"
                pointColor={(n: object) => pointColor(n as NodeGeoPoint, selectedNodeId)}
                pointAltitude={(n: object) => pointAltitude(n as NodeGeoPoint)}
                pointRadius={(n: object) => pointRadius(n as NodeGeoPoint)}
                pointLabel={(n: object) => nodeTooltip(n as NodeGeoPoint)}
                onPointClick={handlePointClick}
                pointsMerge={false}

                // ── Ring pulse on selected node ────────────────────────────
                ringsData={selectedNode ? [selectedNode] : []}
                ringLat={(r: object) => (r as NodeGeoPoint).lat}
                ringLng={(r: object) => (r as NodeGeoPoint).lon}
                ringColor={() => '#f59e0b'}
                ringMaxRadius={0.4}
                ringPropagationSpeed={2.5}
                ringRepeatPeriod={900}
                ringAltitude={0.025}
 
                 // ── Traffic Arcs ──────────────────────────────────────────
                arcsData={trafficArcs}
                arcColor="color"
                arcDashLength={0.4}
                arcDashGap={2}
                arcDashInitialGap={() => Math.random()}
                arcDashAnimateTime={2500}
                arcStroke={0.2}
                arcAltitudeAutoScale={0.5}

                 // ── Session hex-bin density ────────────────────────────────
                hexBinPointsData={showHeatmap ? validNodes : []}
                hexBinPointWeight={(n: object) => (n as NodeGeoPoint).active_sessions + 1}
                hexAltitude={(d: object) => Math.min((d as any).sumWeight * 0.005, 0.25)}
                hexBinResolution={4}
                hexTopColor={() => 'rgba(99,102,241,0.88)'}
                hexSideColor={() => 'rgba(99,102,241,0.3)'}
                hexLabel={hexTooltip}
            />
        </div>
    );
}
