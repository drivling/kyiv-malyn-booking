import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import {
  PRIMARY_SITE,
  SITES,
  siteDomainForRoute,
  siteForCityCode,
  siteForRoute,
  siteUrl,
  siteUrlForRoute,
} from './site-domains';

describe('siteForRoute', () => {
  test('маршрут з Коростенем веде на korosten.kiev.ua', () => {
    assert.equal(siteForRoute('Korosten-Kyiv').domain, 'korosten.kiev.ua');
    assert.equal(siteForRoute('Kyiv-Korosten').domain, 'korosten.kiev.ua');
    assert.equal(siteForRoute('Korosten-Malyn').domain, 'korosten.kiev.ua');
  });

  test('малинівські та київські маршрути лишаються на головному домені', () => {
    assert.equal(siteForRoute('Kyiv-Malyn').domain, 'malin.kiev.ua');
    assert.equal(siteForRoute('Malyn-Kyiv-Irpin').domain, 'malin.kiev.ua');
    assert.equal(siteForRoute('').domain, 'malin.kiev.ua');
    assert.equal(siteForRoute(null).domain, 'malin.kiev.ua');
  });

  test('місто без підключеного домену (Житомир) поки на головному сайті', () => {
    assert.equal(SITES.zhytomyr.active, false);
    assert.equal(siteForRoute('Zhytomyr-Kyiv').domain, 'malin.kiev.ua');
    assert.equal(siteForCityCode('Zhytomyr').key, PRIMARY_SITE.key);
  });

  test('невідомі частини слага ігноруються', () => {
    assert.equal(siteForRoute('Bucha-Irpin').domain, 'malin.kiev.ua');
    assert.equal(siteForRoute('korosten-kyiv').domain, 'korosten.kiev.ua');
  });
});

describe('siteUrl', () => {
  test('складає посилання з шляхом і без', () => {
    assert.equal(siteUrl(SITES.korosten), 'https://korosten.kiev.ua');
    assert.equal(siteUrl(SITES.korosten, '/mizhgorodski'), 'https://korosten.kiev.ua/mizhgorodski');
    assert.equal(siteUrl(SITES.malyn, 'mizhgorodski'), 'https://malin.kiev.ua/mizhgorodski');
  });

  test('хелпери по маршруту', () => {
    assert.equal(siteDomainForRoute('Korosten-Kyiv'), 'korosten.kiev.ua');
    assert.equal(siteUrlForRoute('Korosten-Kyiv'), 'https://korosten.kiev.ua');
    assert.equal(siteUrlForRoute('Kyiv-Malyn', '/mizhgorodski'), 'https://malin.kiev.ua/mizhgorodski');
  });
});
